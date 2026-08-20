-- WIMBridge v2.9.2 — defensive build with in-game visual feedback.
-- Registration (slash + events) happens FIRST and is wrapped so a single
-- error can never leave the addon "loaded but dead".

WIMBRIDGE_VERSION = "2.9.2"

WIMBridgeDB = WIMBridgeDB or {}
if WIMBridgeDB.voiceEnabled == nil then WIMBridgeDB.voiceEnabled = true end
if WIMBridgeDB.combatEnabled == nil then WIMBridgeDB.combatEnabled = true end
if WIMBridgeDB.screenEnabled == nil then WIMBridgeDB.screenEnabled = true end

local ownName = "Unknown"
local alive = { events = false, slash = false, whisperSeen = 0 }

local function bigNotice(text)
    -- Big yellow raid-warning text in the middle of the screen: impossible
    -- to miss. This is the visual feedback that the addon is alive.
    pcall(function()
        RaidNotice_AddMessage(RaidWarningFrame, text, ChatTypeInfo["RAID_WARNING"])
    end)
end

local function normalize(name)
    if not name or name == "" then return "Unknown" end
    if not name:find("-") then
        local realm = (GetNormalizedRealmName and GetNormalizedRealmName()) or (GetRealmName and GetRealmName())
        if realm then
            realm = realm:gsub("%s+", "")
            name = name .. "-" .. realm
        end
    end
    return name
end

local function computeOwnName()
    local n = UnitName and UnitName("player")
    if n then ownName = normalize(n) end
end

-- ============================================================
-- 1) SLASH COMMANDS FIRST (so /wimbridge always works)
-- ============================================================
pcall(function()
    SLASH_WIMBRIDGE1 = "/wimbridge"
    SLASH_WIMBRIDGE2 = "/wbw"
    SlashCmdList["WIMBRIDGE"] = function(cmd)
        computeOwnName()
        cmd = (cmd or ""):lower()
        if cmd == "who" or cmd == "status" then
            print("|cffffcc00WIMBridge|r versao = " .. WIMBRIDGE_VERSION)
            print("|cffffcc00WIMBridge|r own = " .. ownName)
            print("|cffffcc00WIMBridge|r eventos = " .. (alive.events and "OK" or "FALHA"))
            print("|cffffcc00WIMBridge|r whispers capturados = " .. tostring(alive.whisperSeen))
            print("|cffffcc00WIMBridge|r voz/combat/tela = "
                .. tostring(WIMBridgeDB.voiceEnabled ~= false) .. "/"
                .. tostring(WIMBridgeDB.combatEnabled ~= false) .. "/"
                .. tostring(WIMBridgeDB.screenEnabled ~= false))
        elseif cmd == "test" then
            bigNotice("WIMBridge TESTE OK")
            print("|cffffcc00WIMBridge|r teste: se voce leu isso, o addon esta vivo.")
        elseif cmd == "voice" then
            WIMBridgeDB.voiceEnabled = not (WIMBridgeDB.voiceEnabled ~= false)
            print("|cffffcc00WIMBridge|r voz " .. ((WIMBridgeDB.voiceEnabled ~= false) and "LIGADA" or "DESLIGADA"))
        elseif cmd == "combat" then
            WIMBridgeDB.combatEnabled = not (WIMBridgeDB.combatEnabled ~= false)
            print("|cffffcc00WIMBridge|r combatlog " .. ((WIMBridgeDB.combatEnabled ~= false) and "LIGADO" or "DESLIGADO"))
        elseif cmd == "screen" then
            WIMBridgeDB.screenEnabled = not (WIMBridgeDB.screenEnabled ~= false)
            print("|cffffcc00WIMBridge|r tela(OCR) " .. ((WIMBridgeDB.screenEnabled ~= false) and "LIGADA" or "DESLIGADA"))
        else
            print("|cffffcc00WIMBridge|r " .. WIMBRIDGE_VERSION .. " | comandos: who | test | voice | combat | screen")
        end
    end
    alive.slash = true
end)

-- ============================================================
-- 2) EVENT FRAME (whisper capture)
-- ============================================================
local relayChannelName, relayChannelId = nil, nil
local relayFrame, relayText, relayTimer = nil, nil, nil

local function ensureChatLog()
    pcall(function() LoggingChat(true) end)
    pcall(function() LoggingCombat(true) end)
end

local function ensureRelayChannel()
    if not WIMBridgeDB.channelSuffix then
        pcall(function()
            math.randomseed(time() + (UnitGUID("player") or "0"):len())
            WIMBridgeDB.channelSuffix = tostring(math.random(100000, 999999))
        end)
    end
    if not relayChannelName then
        relayChannelName = "BW" .. (ownName:gsub("%W", "")) .. (WIMBridgeDB.channelSuffix or "1")
    end
    local id = GetChannelName and GetChannelName(relayChannelName)
    if id and id > 0 then relayChannelId = id; return true end
    pcall(function() JoinChannelByName(relayChannelName) end)
    id = GetChannelName and GetChannelName(relayChannelName)
    if id and id > 0 then relayChannelId = id; return true end
    return false
end

local function ensureScreenFrame()
    if relayFrame or WIMBridgeDB.screenEnabled == false then return end
    pcall(function()
        relayFrame = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
        relayFrame:SetSize(1000, 30)
        relayFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 2, -2)
        relayFrame:SetBackdrop({ bgFile = "Interface/Tooltips/UI-Tooltip-Background" })
        relayFrame:SetBackdropColor(0, 0, 0, 0.95)
        relayFrame:SetFrameStrata("FULLSCREEN_DIALOG")
        relayText = relayFrame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
        relayText:SetPoint("LEFT", relayFrame, "LEFT", 6, 0)
        relayText:SetWidth(990)
        relayText:SetJustifyH("LEFT")
        relayText:SetTextColor(1, 1, 0)
        relayFrame:Hide()
    end)
end

local function showScreen(text)
    if WIMBridgeDB.screenEnabled == false then return end
    ensureScreenFrame()
    if not relayFrame then return end
    pcall(function()
        relayText:SetText(text)
        relayFrame:Show()
        if relayTimer then relayTimer:Cancel() end
        relayTimer = C_Timer.NewTimer(6, function() if relayFrame then relayFrame:Hide() end end)
    end)
end

local NATO = {
    A="Alpha",B="Bravo",C="Charlie",D="Delta",E="Echo",F="Foxtrot",G="Golf",
    H="Hotel",I="India",J="Juliet",K="Kilo",L="Lima",M="Mike",N="November",
    O="Oscar",P="Papa",Q="Quebec",R="Romeo",S="Sierra",T="Tango",U="Uniform",
    V="Victor",W="Whiskey",X="Xray",Y="Yankee",Z="Zulu",
    ["0"]="Zero",["1"]="One",["2"]="Two",["3"]="Three",["4"]="Four",
    ["5"]="Five",["6"]="Six",["7"]="Seven",["8"]="Eight",["9"]="Niner",["-"]="Dash",
}
local function natoSpell(s)
    local out = {}
    for ch in (s or ""):gmatch(".") do
        local w = NATO[ch:upper()]
        if w then out[#out + 1] = w end
    end
    return table.concat(out, ". ")
end

local function speak(text)
    if WIMBridgeDB.voiceEnabled == false then return end
    pcall(function()
        if C_VoiceChat and C_VoiceChat.SpeakText then
            local voices = C_VoiceChat.GetTtsVoices and C_VoiceChat.GetTtsVoices()
            local vid = voices and voices[1] and voices[1].voiceID or 0
            C_VoiceChat.SpeakText(vid, text)
        end
    end)
end

local function relay(kind, other, body)
    alive.whisperSeen = alive.whisperSeen + 1
    local line = string.format("WIMRELAY<OWN:%s><%s:%s><TS:%d>%s",
        ownName, kind == "in" and "FROM" or "TO", other, time(), body or "")
    -- visible echo (helps debugging in default chat)
    pcall(function()
        if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
            DEFAULT_CHAT_FRAME:AddMessage("|cffffcc00" .. line .. "|r", 1, 1, 0)
        end
    end)
    -- channel relay (chatlog)
    pcall(function()
        if ensureRelayChannel() and relayChannelId then
            local p = line
            if #p > 250 then p = p:sub(1, 250) end
            SendChatMessage(p, "CHANNEL", nil, relayChannelId)
        end
    end)
    -- combatlog relay (emote) — flushes fast
    if WIMBridgeDB.combatEnabled ~= false then
        pcall(function()
            local p = line
            if #p > 250 then p = p:sub(1, 250) end
            SendChatMessage(p, "EMOTE")
        end)
    end
    -- screen relay (OCR)
    showScreen(line)
    -- voice relay (loopback/mic)
    speak(string.format("Wimbridge. Own %s. %s %s. Message %s. Endbridge.",
        natoSpell(ownName), kind == "in" and "From" or "To", natoSpell(other), body or ""))
    -- feedback visual: small raid notice per captured whisper
    bigNotice("WIMBridge: " .. (kind == "in" and "recebido" or "enviado") .. " -> site")
end

pcall(function()
    local f = CreateFrame("Frame")
    f:RegisterEvent("CHAT_MSG_WHISPER")
    f:RegisterEvent("CHAT_MSG_WHISPER_INFORM")
    f:RegisterEvent("CHAT_MSG_BN_WHISPER")
    f:RegisterEvent("CHAT_MSG_BN_WHISPER_INFORM")
    f:RegisterEvent("PLAYER_LOGIN")
    f:RegisterEvent("PLAYER_ENTERING_WORLD")
    f:SetScript("OnEvent", function(_, event, msg, target)
        if event == "PLAYER_LOGIN" or event == "PLAYER_ENTERING_WORLD" then
            computeOwnName()
            ensureChatLog()
            alive.events = true
            bigNotice("WIMBridge " .. WIMBRIDGE_VERSION .. " ATIVO")
            return
        end
        if ownName == "Unknown" then computeOwnName() end
        ensureChatLog()
        if event == "CHAT_MSG_WHISPER" or event == "CHAT_MSG_BN_WHISPER" then
            relay("in", normalize(target), msg or "")
        elseif event == "CHAT_MSG_WHISPER_INFORM" or event == "CHAT_MSG_BN_WHISPER_INFORM" then
            relay("out", normalize(target), msg or "")
        end
    end)
    alive.events = true
end)

print("|cffffcc00WIMBridge|r v" .. WIMBRIDGE_VERSION .. " carregado. Digite /wimbridge who para confirmar.")
