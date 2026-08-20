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
local flushScheduled = false
local flushAgain = false

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

local function isChatLogEnabled()
    local ok, logging = pcall(function()
        if C_ChatInfo and C_ChatInfo.IsLoggingChat then
            return C_ChatInfo.IsLoggingChat()
        end
        if LoggingChat then return LoggingChat() end
        return false
    end)
    return ok and logging == true
end

local function ensureChatLog()
    -- The bridge tails WoWChatLog.txt. Enable it automatically so an incoming
    -- whisper is not silently lost just because /chatlog was forgotten after
    -- restarting the game. Support both modern C_ChatInfo and legacy API.
    if not isChatLogEnabled() then
        pcall(function()
            if LoggingChat then
                LoggingChat(1)
            end
        end)
    end
end

local function forceChatLogFlush()
    -- Blizzard buffers WoWChatLog.txt until logout in many Retail builds.
    -- Toggling LoggingChat closes/flushes the current file handle; reopening
    -- it immediately lets the external bridge tail the new line while WoW is
    -- still running. Coalesce bursts so several whispers do not thrash the
    -- logger.
    if not LoggingChat then return end
    if flushScheduled then
        flushAgain = true
        return
    end
    flushScheduled = true
    flushAgain = false
    local function reopen()
        pcall(function() LoggingChat(1) end)
        flushScheduled = false
        if flushAgain then
            flushAgain = false
            forceChatLogFlush()
        end
    end
    pcall(function() LoggingChat(0) end)
    if C_Timer and C_Timer.After then
        C_Timer.After(0.25, reopen)
    else
        reopen()
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
    -- IMPORTANT: whisper the short character name, not Name-Realm. Some WoW
    -- clients reject a self-whisper addressed with the realm suffix.
    local ownShort = UnitName("player")
    if not ownShort or not SendChatMessage then return end
    local ts = math.floor(when or time() or 0)
    local payload = string.format(
        "%s<OWN:%s><FROM:%s><TS:%d>%s",
        RELAY_PREFIX, ownName, from, ts, msg or ""
    )
    -- Keep room for WoW's whisper size limit. Normal whispers are well below
    -- this; the regular CHAT_MSG event/log remains the fallback for longer.
    if #payload > 240 then payload = payload:sub(1, 240) end
    local function sendRelay()
        pcall(function()
            SendChatMessage(payload, "WHISPER", nil, ownShort)
        end)
    end
    sendRelay()
    -- A small retry handles the client refusing a self-whisper while it is
    -- still dispatching CHAT_MSG_WHISPER. Same TS makes it idempotent.
    if C_Timer and C_Timer.After then
        C_Timer.After(0.5, sendRelay)
    end
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
    -- Flush after the native whisper and relay have had time to enter the
    -- chat logger; the bridge should see this while the game is open.
    if C_Timer and C_Timer.After then
        C_Timer.After(0.8, forceChatLogFlush)
    else
        forceChatLogFlush()
    end
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
        local t = time()
        echoLine("TestPlayer-TestRealm", "hello world", t)
        -- Test the REAL external pipeline too: this produces a native whisper
        -- log line for the Python bridge, not just a visual ChatFrame line.
        relayReceived("TestPlayer-TestRealm", "hello world", t)
        print("|cffffcc00WIMBridge|r teste visual + relay emitido; confira o log do bridge.")
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
    elseif cmd == "flush" then
        ensureChatLog()
        forceChatLogFlush()
        print("|cffffcc00WIMBridge|r flush do WoWChatLog solicitado.")
    elseif cmd == "help" or cmd == "" then
        print("|cffffcc00WIMBridge|r OK. Use: /wimbridge who | /wimbridge test | /wimbridge dump | /wimbridge flush")
        print("|cffffcc00WIMBridge|r aliases: /wim who, /wbridge who")
    else
        print("|cffffcc00WIMBridge|r comando desconhecido. Use /wimbridge help")
    end
end

-- Global flag makes troubleshooting via /run WIMBridgeLoaded possible.
WIMBridgeLoaded = true
print("|cffffcc00WIMBridge|r v2.3 carregado! Use /wimbridge who (ou /wim who).")
