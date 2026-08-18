-- WIMBridge (multi-window edition)
-- Echoes every received whisper into the chat frame with a well-known
-- prefix so that /chatlog captures a line easy to parse from Python:
--
--   [WIMBRIDGE]<OWN:MyChar-Realm><FROM:Sender-Realm>message text

local f = CreateFrame("Frame")
f:RegisterEvent("CHAT_MSG_WHISPER")
f:RegisterEvent("CHAT_MSG_BN_WHISPER")
f:RegisterEvent("PLAYER_LOGIN")

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

f:SetScript("OnEvent", function(_, event, msg, sender)
    if event == "PLAYER_LOGIN" then
        computeOwnName()
        return
    end
    if ownName == "Unknown" then computeOwnName() end
    local from = normalize(sender)
    local line = string.format("[WIMBRIDGE]<OWN:%s><FROM:%s>%s", ownName, from, msg or "")
    if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
        DEFAULT_CHAT_FRAME:AddMessage(line, 0.6, 0.6, 1.0)
    end
end)

SLASH_WIMBRIDGE1 = "/wimbridge"
SlashCmdList["WIMBRIDGE"] = function(cmd)
    if cmd == "test" then
        computeOwnName()
        local line = string.format("[WIMBRIDGE]<OWN:%s><FROM:TestPlayer-TestRealm>hello world", ownName)
        DEFAULT_CHAT_FRAME:AddMessage(line, 0.6, 0.6, 1.0)
    elseif cmd == "who" then
        computeOwnName()
        print("|cffffcc00WIMBridge|r own = " .. ownName)
    else
        print("|cffffcc00WIMBridge|r ativo. Comandos: /wimbridge test | /wimbridge who")
    end
end

print("|cffffcc00WIMBridge|r carregado. Whispers serão ecoados com tag [WIMBRIDGE].")
