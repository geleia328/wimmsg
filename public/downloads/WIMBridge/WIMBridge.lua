-- WIMBridge (multi-window edition)
-- 1) Echoes every received whisper into the chat frame with a well-known
--    prefix so that /chatlog captures a line easy to parse from Python:
--
--      [WIMBRIDGE]<OWN:MyChar-Realm><FROM:Sender-Realm><TS:1726000000>text
--
--    The <TS:...> epoch timestamp makes the line IDEMPOTENT: the bridge can
--    re-read the same line (replay, dump, log rotation) without duplicating.
-- 2) Stores every received whisper in SavedVariables (WIMBridgeDB) so the
--    history survives relogs. The bridge asks for a full dump via
--    "/wimbridge dump" when a window is detected — this recovers whispers
--    that happened while /chatlog was off or before the bridge started.

local f = CreateFrame("Frame")
f:RegisterEvent("CHAT_MSG_WHISPER")
f:RegisterEvent("CHAT_MSG_BN_WHISPER")
f:RegisterEvent("CHAT_MSG_WHISPER_INFORM")
f:RegisterEvent("PLAYER_LOGIN")
f:RegisterEvent("PLAYER_ENTERING_WORLD")

local HISTORY_MAX = 300
local RELAY_PREFIX = "[WIMRELAY]"

-- SavedVariables: survives relogs per account.
local DB = WIMBridgeDB or {}
if not DB.history then DB.history = {} end
WIMBridgeDB = DB

local ownName = "Unknown"

local function normalize(name)
    if not name or name == "" then return "Unknown" end
    if not name:find("-") then
        local realm = GetNormalizedRealmName and GetNormalizedRealmName() or GetRealmName()
        if realm then
            realm = realm:gsub("%s+", "")
            name = name .. "-" .. realm
        end
    end
    return name
end

local function computeOwnName()
    local n = UnitName("player")
    if n then ownName = normalize(n) end
end

local function ensureChatLog()
    -- The bridge tails WoWChatLog.txt. Enable it automatically so an incoming
    -- whisper is not silently lost just because /chatlog was forgotten after
    -- restarting the game. Support both modern C_ChatInfo and legacy API.
    local ok, logging = pcall(function()
        if C_ChatInfo and C_ChatInfo.IsLoggingChat then
            return C_ChatInfo.IsLoggingChat()
        end
        if LoggingChat then return LoggingChat() end
        return false
    end)
    if ok and not logging then
        pcall(function()
            if LoggingChat then
                LoggingChat(1)
            end
        end)
    end
end

local function echoLine(from, msg, when)
    local ts = math.floor(when or time() or 0)
    local line = string.format(
        "[WIMBRIDGE]<OWN:%s><FROM:%s><TS:%d>%s",
        ownName, from, ts, msg or ""
    )
    if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
        DEFAULT_CHAT_FRAME:AddMessage(line, 0.6, 0.6, 1.0)
    end
end

local function storeReceived(from, msg, when)
    local ts = when or time() or 0
    table.insert(DB.history, { from = from, body = msg or "", t = ts })
    if #DB.history > HISTORY_MAX then
        table.remove(DB.history, 1)
    end
end

local function relayReceived(from, msg, when)
    -- WoW's native chat logger records real chat-system messages much more
    -- reliably than arbitrary ChatFrame:AddMessage output. Send a private
    -- marker to the SAME character; the bridge reads that logged line and
    -- converts it back into the original incoming whisper. The UI filter
    -- below hides this transport marker from the player.
    local own = UnitName("player")
    if not own or not SendChatMessage then return end
    local ts = math.floor(when or time() or 0)
    local payload = string.format(
        "%s<OWN:%s><FROM:%s><TS:%d>%s",
        RELAY_PREFIX, ownName, from, ts, msg or ""
    )
    -- Keep room for WoW's whisper size limit. Normal whispers are well below
    -- this; the regular CHAT_MSG event/log remains the fallback for longer.
    if #payload > 240 then payload = payload:sub(1, 240) end
    pcall(function()
        SendChatMessage(payload, "WHISPER", nil, own)
    end)
end

local function hideRelay(_, event, message)
    if message and message:sub(1, #RELAY_PREFIX) == RELAY_PREFIX then
        return true
    end
end

if ChatFrame_AddMessageEventFilter then
    ChatFrame_AddMessageEventFilter("CHAT_MSG_WHISPER", hideRelay)
    ChatFrame_AddMessageEventFilter("CHAT_MSG_WHISPER_INFORM", hideRelay)
end

f:SetScript("OnEvent", function(_, event, msg, sender)
    if event == "PLAYER_LOGIN" then
        computeOwnName()
        ensureChatLog()
        return
    end
    if event == "PLAYER_ENTERING_WORLD" then
        computeOwnName()
        -- Delay slightly so the client has initialized the chat logger.
        if C_Timer and C_Timer.After then
            C_Timer.After(1, ensureChatLog)
        else
            ensureChatLog()
        end
        return
    end
    -- The relay is sent to self and causes a whisper-inform event. It is a
    -- transport marker, not a second real received whisper.
    if msg and msg:sub(1, #RELAY_PREFIX) == RELAY_PREFIX then
        return
    end
    if event == "CHAT_MSG_WHISPER_INFORM" then
        return
    end
    if ownName == "Unknown" then computeOwnName() end
    ensureChatLog()
    local from = normalize(sender)
    local t = time()
    echoLine(from, msg, t)
    storeReceived(from, msg, t)
    relayReceived(from, msg, t)
end)

-- Register multiple aliases: if /wimbridge is claimed by another addon,
-- /wim and /wbridge still provide a reliable way to test this addon.
SLASH_WIMBRIDGE1 = "/wimbridge"
SLASH_WIMBRIDGE2 = "/wim"
SLASH_WIMBRIDGE3 = "/wbridge"
SlashCmdList["WIMBRIDGE"] = function(raw)
    local cmd = tostring(raw or "")
    cmd = cmd:match("^%s*(.-)%s*$"):lower()
    if cmd == "test" then
        computeOwnName()
        echoLine("TestPlayer-TestRealm", "hello world", time())
        print("|cffffcc00WIMBridge|r teste emitido no chatlog.")
    elseif cmd == "dump" then
        -- Re-print the whole stored history with the SAME <TS> values, so the
        -- bridge can ingest them idempotently (no duplicates on re-dump).
        computeOwnName()
        local n = #DB.history
        print(string.format("|cffffcc00WIMBridge|r dumpando %d whispers...", n))
        for i = 1, n do
            local e = DB.history[i]
            echoLine(e.from, e.body, e.t)
        end
        print(string.format("|cffffcc00WIMBridge|r dump concluido (%d mensagens)", n))
    elseif cmd == "who" then
        computeOwnName()
        ensureChatLog()
        print("|cffffcc00WIMBridge|r own = " .. ownName)
        print("|cffffcc00WIMBridge|r addon carregado; chatlog = ativado/tentado.")
    elseif cmd == "help" or cmd == "" then
        print("|cffffcc00WIMBridge|r OK. Use: /wimbridge who | /wimbridge test | /wimbridge dump")
        print("|cffffcc00WIMBridge|r aliases: /wim who, /wbridge who")
    else
        print("|cffffcc00WIMBridge|r comando desconhecido. Use /wimbridge help")
    end
end

-- Global flag makes troubleshooting via /run WIMBridgeLoaded possible.
WIMBridgeLoaded = true
print("|cffffcc00WIMBridge|r v2.2 carregado! Use /wimbridge who (ou /wim who).")
