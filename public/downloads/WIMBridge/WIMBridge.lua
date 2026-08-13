-- WIMBridge (multi-window edition)
-- Captures received AND sent whispers and mirrors them to the default chat
-- frame with a well-known prefix so that WoWChatLog.txt can be read by the
-- Bakers Whisper bridge.
--
-- Incoming: [WIMBRIDGE]<OWN:MyChar-Realm><FROM:Sender-Realm>message text
-- Outgoing: [WIMBRIDGE]<OWN:MyChar-Realm><TO:Recipient-Realm>message text

local f = CreateFrame("Frame")
f:RegisterEvent("CHAT_MSG_WHISPER")
f:RegisterEvent("CHAT_MSG_WHISPER_INFORM")
f:RegisterEvent("CHAT_MSG_BN_WHISPER")
f:RegisterEvent("CHAT_MSG_BN_WHISPER_INFORM")
f:RegisterEvent("PLAYER_LOGIN")
f:RegisterEvent("PLAYER_ENTERING_WORLD")

local ownName = "Unknown"
local chatLoggingEnabled = false

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
    -- Equivalent to typing /chatlog, but automatic. This is critical because
    -- the Python bridge can only read what WoW writes to Logs/WoWChatLog.txt.
    if LoggingChat then
        local ok = pcall(function() LoggingChat(true) end)
        if ok and not chatLoggingEnabled then
            chatLoggingEnabled = true
            print("|cffffcc00WIMBridge|r /chatlog ativado automaticamente.")
        end
    end
end

local function echo(line)
    ensureChatLog()
    -- Use both DEFAULT_CHAT_FRAME and ChatFrame1 if available. Some UI/WIM
    -- layouts replace DEFAULT_CHAT_FRAME; this maximizes chance of reaching
    -- the visible/logged chat frame.
    if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
        DEFAULT_CHAT_FRAME:AddMessage(line, 0.6, 0.6, 1.0)
    elseif ChatFrame1 and ChatFrame1.AddMessage then
        ChatFrame1:AddMessage(line, 0.6, 0.6, 1.0)
    end
end

f:SetScript("OnEvent", function(_, event, msg, target)
    if event == "PLAYER_LOGIN" or event == "PLAYER_ENTERING_WORLD" then
        computeOwnName()
        ensureChatLog()
        return
    end

    if ownName == "Unknown" then computeOwnName() end
    ensureChatLog()

    if event == "CHAT_MSG_WHISPER" or event == "CHAT_MSG_BN_WHISPER" then
        local from = normalize(target)
        echo(string.format("[WIMBRIDGE]<OWN:%s><FROM:%s>%s", ownName, from, msg or ""))
        return
    end

    if event == "CHAT_MSG_WHISPER_INFORM" or event == "CHAT_MSG_BN_WHISPER_INFORM" then
        local to = normalize(target)
        echo(string.format("[WIMBRIDGE]<OWN:%s><TO:%s>%s", ownName, to, msg or ""))
        return
    end
end)

SLASH_WIMBRIDGE1 = "/wimbridge"
SlashCmdList["WIMBRIDGE"] = function(cmd)
    computeOwnName()
    ensureChatLog()
    if cmd == "test" then
        echo(string.format("[WIMBRIDGE]<OWN:%s><FROM:TestPlayer-TestRealm>hello world", ownName))
    elseif cmd == "testout" then
        echo(string.format("[WIMBRIDGE]<OWN:%s><TO:TestPlayer-TestRealm>outgoing hello", ownName))
    elseif cmd == "who" then
        print("|cffffcc00WIMBridge|r own = " .. ownName)
    elseif cmd == "log" then
        ensureChatLog()
        print("|cffffcc00WIMBridge|r /chatlog solicitado novamente.")
    else
        print("|cffffcc00WIMBridge|r ativo. Comandos: /wimbridge test | /wimbridge testout | /wimbridge who | /wimbridge log")
    end
end

print("|cffffcc00WIMBridge|r carregado. Whispers recebidos/enviados serão ecoados com tag [WIMBRIDGE].")
