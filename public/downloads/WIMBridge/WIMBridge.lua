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
f:RegisterEvent("PLAYER_LOGIN")

local HISTORY_MAX = 300

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

f:SetScript("OnEvent", function(_, event, msg, sender)
    if event == "PLAYER_LOGIN" then
        computeOwnName()
        return
    end
    if ownName == "Unknown" then computeOwnName() end
    local from = normalize(sender)
    local t = time()
    echoLine(from, msg, t)
    storeReceived(from, msg, t)
end)

SLASH_WIMBRIDGE1 = "/wimbridge"
SlashCmdList["WIMBRIDGE"] = function(cmd)
    if cmd == "test" then
        computeOwnName()
        echoLine("TestPlayer-TestRealm", "hello world", time())
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
        print("|cffffcc00WIMBridge|r own = " .. ownName)
    else
        print("|cffffcc00WIMBridge|r ativo. Comandos: /wimbridge test | /wimbridge who | /wimbridge dump")
    end
end

print("|cffffcc00WIMBridge|r carregado. Whispers serao ecoados com tag [WIMBRIDGE].")
