-- WIMBridge (multi-window edition) — v2.6.0 VOICE RELAY
-- Captures received AND sent whispers. Three parallel delivery paths so the
-- site gets messages in real time no matter how the WoW client behaves:
--   1) private relay channel  -> WoWChatLog.txt (works when log flushes)
--   2) delayed multi flush    -> forces WoWChatLog.txt to disk
--   3) VOICE (default ON)     -> the addon SPEAKS each whisper; the Python
--      bridge listens on the microphone, transcribes it and posts it to the
--      site. Names are spelled with the NATO phonetic alphabet so they are
--      NEVER misheard/miswritten. This path does not depend on WoWChatLog.

local f = CreateFrame("Frame")
f:RegisterEvent("CHAT_MSG_WHISPER")
f:RegisterEvent("CHAT_MSG_WHISPER_INFORM")
f:RegisterEvent("CHAT_MSG_BN_WHISPER")
f:RegisterEvent("CHAT_MSG_BN_WHISPER_INFORM")
f:RegisterEvent("PLAYER_LOGIN")
f:RegisterEvent("PLAYER_ENTERING_WORLD")

WIMBridgeDB = WIMBridgeDB or {}
if WIMBridgeDB.voiceEnabled == nil then WIMBridgeDB.voiceEnabled = true end
if WIMBridgeDB.combatEnabled == nil then WIMBridgeDB.combatEnabled = true end
if WIMBridgeDB.screenEnabled == nil then WIMBridgeDB.screenEnabled = true end

-- On-screen relay frame: a fixed high-contrast strip at the top-left that
-- always shows the last relay payload. The bridge screenshots this strip and
-- reads it with Windows OCR — no log flushing, no microphone, exact names.
local relayFrame, relayText, relayTimer = nil, nil, nil
local function ensureScreenFrame()
    if relayFrame or WIMBridgeDB.screenEnabled == false then return end
    local ok = pcall(function()
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
    if not ok then relayFrame = nil end
end
local function showScreen(text)
    if WIMBridgeDB.screenEnabled == false then return end
    ensureScreenFrame()
    if not relayFrame then return end
    relayText:SetText(text)
    relayFrame:Show()
    if relayTimer then relayTimer:Cancel() end
    relayTimer = C_Timer.NewTimer(6, function() if relayFrame then relayFrame:Hide() end end)
end

local ownName = "Unknown"
local chatLoggingEnabled = false
local relayChannelName = nil
local relayChannelId = nil
local flushGeneration = 0

local NATO = {
    A="Alpha",B="Bravo",C="Charlie",D="Delta",E="Echo",F="Foxtrot",G="Golf",
    H="Hotel",I="India",J="Juliet",K="Kilo",L="Lima",M="Mike",N="November",
    O="Oscar",P="Papa",Q="Quebec",R="Romeo",S="Sierra",T="Tango",U="Uniform",
    V="Victor",W="Whiskey",X="Xray",Y="Yankee",Z="Zulu",
    ["0"]="Zero",["1"]="One",["2"]="Two",["3"]="Three",["4"]="Four",
    ["5"]="Five",["6"]="Six",["7"]="Seven",["8"]="Eight",["9"]="Niner",
    ["-"]="Dash",
}

local function natoSpell(s)
    local out = {}
    for ch in (s or ""):gmatch(".") do
        local word = NATO[ch:upper()]
        if word then
            out[#out + 1] = word
        elseif ch:match("%w") then
            out[#out + 1] = ch
        end
    end
    return table.concat(out, ". ")
end

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

local function sanitize(s)
    s = s or "Unknown"
    s = s:gsub("[^A-Za-z0-9]", "")
    if s == "" then s = "Unknown" end
    return s
end

local function enableChatLog(silent)
    if not LoggingChat then return end
    local ok = pcall(function() LoggingChat(true) end)
    if ok then
        if not chatLoggingEnabled and not silent then
            print("|cffffcc00WIMBridge|r /chatlog ativado automaticamente.")
        end
        chatLoggingEnabled = true
    end
end

local function forceFlush(label)
    if not LoggingChat then return end
    pcall(function() LoggingChat(false) end)
    C_Timer.After(0.35, function()
        pcall(function() LoggingChat(true) end)
        chatLoggingEnabled = true
        if label then print("|cff88ff88WIMBridge|r flush " .. label) end
    end)
end

local function scheduleMultiFlush()
    flushGeneration = flushGeneration + 1
    local gen = flushGeneration
    C_Timer.After(1.5, function() if gen == flushGeneration then forceFlush("1/3") end end)
    C_Timer.After(3.0, function() if gen == flushGeneration then forceFlush("2/3") end end)
    C_Timer.After(5.0, function() if gen == flushGeneration then forceFlush("3/3") end end)
end

local function ensureRelayChannel()
    if not WIMBridgeDB.channelSuffix then
        math.randomseed(time() + (UnitGUID("player") or "0"):len())
        WIMBridgeDB.channelSuffix = tostring(math.random(100000, 999999))
    end
    if not relayChannelName then
        relayChannelName = "BW" .. sanitize(GetRealmName()) .. WIMBridgeDB.channelSuffix
    end
    local id = GetChannelName(relayChannelName)
    if id and id > 0 then relayChannelId = id; return true end
    -- IMPORTANT: use a NORMAL channel, not a temporary one. Some WoW clients
    -- do NOT write temporary-channel traffic to WoWChatLog.txt, which made
    -- the relay invisible to the bridge.
    pcall(function() JoinChannelByName(relayChannelName) end)
    id = GetChannelName(relayChannelName)
    if id and id > 0 then
        relayChannelId = id
        -- Keep it out of the visible chat frames to reduce noise.
        pcall(function()
            local info = C_ChatInfo and C_ChatInfo.GetChannelInfoFromIdentifier and nil
            ChatFrame_RemoveChannel(DEFAULT_CHAT_FRAME, relayChannelName)
        end)
        print("|cffffcc00WIMBridge|r canal relay ativo: " .. relayChannelName)
        return true
    end
    return false
end

local function echoVisible(line)
    if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
        DEFAULT_CHAT_FRAME:AddMessage(line, 0.6, 0.6, 1.0)
    elseif ChatFrame1 and ChatFrame1.AddMessage then
        ChatFrame1:AddMessage(line, 0.6, 0.6, 1.0)
    end
end

local voiceID = nil
local function pickVoice()
    if voiceID then return voiceID end
    local ok, voices = pcall(function()
        return C_VoiceChat and C_VoiceChat.GetTtsVoices and C_VoiceChat.GetTtsVoices()
    end)
    if ok and voices then
        for _, v in ipairs(voices) do
            if v and v.voiceID then
                -- prefer English voices so NATO words are pronounced correctly
                local nm = (v.name or ""):lower()
                if nm:find("en") or nm:find("english") or nm:find("david") or nm:find("zira") then
                    voiceID = v.voiceID
                    return voiceID
                end
                if not voiceID then voiceID = v.voiceID end
            end
        end
    end
    return voiceID
end

local function speak(text)
    if not WIMBridgeDB.voiceEnabled then return end
    local vid = pickVoice()
    if C_VoiceChat and C_VoiceChat.SpeakText then
        local ok = pcall(function() C_VoiceChat.SpeakText(vid or 0, text) end)
        if ok then return end
    end
    -- older/alternate API
    if SpeakText then pcall(function() SpeakText(text) end) end
end

local function relay(kind, other, body)
    enableChatLog(true)
    local tag = kind == "in" and "FROM" or "TO"
    local line = string.format("WIMRELAY<OWN:%s><%s:%s><TS:%d>%s", ownName, tag, other, time(), body or "")
    echoVisible(line)

    if ensureRelayChannel() and relayChannelId then
        local short = line
        if #short > 240 then short = short:sub(1, 240) end
        pcall(function() SendChatMessage(short, "CHANNEL", nil, relayChannelId) end)
        scheduleMultiFlush()
    end

    -- VOICE path: speak the whisper with names spelled phonetically.
    local spoken = string.format(
        "Wimbridge. Own %s. %s %s. Message %s. Endbridge.",
        natoSpell(ownName),
        kind == "in" and "From" or "To",
        natoSpell(other),
        body or ""
    )
    speak(spoken)

    -- COMBAT LOG path (real-time): a custom emote is written to
    -- WoWCombatLog.txt almost instantly, so the bridge reads it in real time
    -- even on clients where WoWChatLog.txt only flushes on logout.
    -- NOTE: emotes are visible to nearby players — disable with
    -- /wimbridge combat if you don't want that.
    if WIMBridgeDB.combatEnabled ~= false then
        local payload = line
        if #payload > 250 then payload = payload:sub(1, 250) end
        pcall(function() SendChatMessage(payload, "EMOTE") end)
    end

    -- SCREEN relay: show the payload in the fixed strip for the OCR reader.
    showScreen(line)
end

f:SetScript("OnEvent", function(_, event, msg, target)
    if event == "PLAYER_LOGIN" or event == "PLAYER_ENTERING_WORLD" then
        computeOwnName()
        enableChatLog(false)
        -- The combat log flushes to disk almost instantly (unlike the chat
        -- log on some clients), so we use it as the real-time relay.
        pcall(function() LoggingCombat(true) end)
        C_Timer.After(2, ensureRelayChannel)
        return
    end

    if ownName == "Unknown" then computeOwnName() end
    enableChatLog(true)
    ensureRelayChannel()

    if event == "CHAT_MSG_WHISPER" or event == "CHAT_MSG_BN_WHISPER" then
        relay("in", normalize(target), msg or "")
        return
    end
    if event == "CHAT_MSG_WHISPER_INFORM" or event == "CHAT_MSG_BN_WHISPER_INFORM" then
        relay("out", normalize(target), msg or "")
        return
    end
end)

SLASH_WIMBRIDGE1 = "/wimbridge"
SlashCmdList["WIMBRIDGE"] = function(cmd)
    computeOwnName()
    enableChatLog(false)
    ensureRelayChannel()
    if cmd == "test" then
        relay("in", "TestPlayer-TestRealm", "hello world")
    elseif cmd == "testout" then
        relay("out", "TestPlayer-TestRealm", "outgoing hello")
    elseif cmd == "who" then
        print("|cffffcc00WIMBridge|r own = " .. ownName)
        print("|cffffcc00WIMBridge|r relay = " .. (relayChannelName or "not-ready"))
        print("|cffffcc00WIMBridge|r voz = " .. (WIMBridgeDB.voiceEnabled and "ligada" or "desligada"))
    elseif cmd == "voice" then
        WIMBridgeDB.voiceEnabled = not WIMBridgeDB.voiceEnabled
        print("|cffffcc00WIMBridge|r voz " .. (WIMBridgeDB.voiceEnabled and "LIGADA" or "DESLIGADA"))
    elseif cmd == "combat" then
        WIMBridgeDB.combatEnabled = not (WIMBridgeDB.combatEnabled ~= false)
        print("|cffffcc00WIMBridge|r relay combatlog " .. ((WIMBridgeDB.combatEnabled ~= false) and "LIGADO" or "DESLIGADO"))
        if WIMBridgeDB.combatEnabled ~= false then
            pcall(function() LoggingCombat(true) end)
        end
    elseif cmd == "screen" then
        WIMBridgeDB.screenEnabled = not (WIMBridgeDB.screenEnabled ~= false)
        print("|cffffcc00WIMBridge|r quadro de tela (OCR) " .. ((WIMBridgeDB.screenEnabled ~= false) and "LIGADO" or "DESLIGADO"))
        if WIMBridgeDB.screenEnabled == false and relayFrame then
            relayFrame:Hide()
        end
    elseif cmd == "log" then
        enableChatLog(false)
        forceFlush("manual")
    elseif cmd == "flush" then
        forceFlush("manual")
    elseif cmd == "channel" then
        print("|cffffcc00WIMBridge|r relay channel = " .. (relayChannelName or "not-ready"))
    else
        print("|cffffcc00WIMBridge|r comandos: test | testout | who | voice | combat | screen | log | flush | channel")
    end
end

print("|cffffcc00WIMBridge|r v2.6.0 carregado. Relay canal + flush + VOZ ativos.")
