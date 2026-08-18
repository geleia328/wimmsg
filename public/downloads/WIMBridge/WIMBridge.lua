-- WIMBridge 2.6.0
-- Duas rotas de entrega de whispers pro bridge:
--  (A) canal privado + multi-flush do /chatlog (legado, deixa por segurança).
--  (B) TTS estruturado: o addon manda a placa de som falar uma frase
--      determinística que o bridge captura via loopback e transcreve com
--      speech-to-text. Isso contorna qualquer atraso do WoWChatLog.txt.
--
-- Formato falado (em inglês para maximizar acerto do Whisper):
--   "bridge from C B S I E S dash A Z R A L O N says hello there end"
--   "bridge to   J U P E R dash A Z R A L O N says ok end"
-- Os nomes vão soletrados letra a letra, hifens viram a palavra "dash".

local ADDON_NAME = "WIMBridge"
local VERSION = "2.6.0"
local DEFAULT_CHANNEL_PREFIX = "wimbr"

WIMBridgeDB = WIMBridgeDB or {}
if WIMBridgeDB.ttsEnabled == nil then WIMBridgeDB.ttsEnabled = true end
if WIMBridgeDB.channelEnabled == nil then WIMBridgeDB.channelEnabled = true end
if WIMBridgeDB.ttsRate == nil then WIMBridgeDB.ttsRate = 3 end
if WIMBridgeDB.ttsVolume == nil then WIMBridgeDB.ttsVolume = 100 end

local f = CreateFrame("Frame")
local state = {
    channelName = nil,
    channelIndex = nil,
    loggingOn = false,
    voiceId = nil,
}

local function log(msg)
    if DEFAULT_CHAT_FRAME then
        DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99[WIMBridge]|r " .. tostring(msg))
    end
end

-- ---------------------------------------------------------------------------
-- Chatlog + canal relay (rota A, mantida para compatibilidade)
-- ---------------------------------------------------------------------------
local function ensureChatLog()
    if not state.loggingOn then
        LoggingChat(true)
        state.loggingOn = true
    end
end

local function toggleFlush()
    LoggingChat(false)
    C_Timer.After(0.35, function()
        LoggingChat(true)
        state.loggingOn = true
    end)
end

local function scheduleMultiFlush()
    C_Timer.After(1.5, toggleFlush)
    C_Timer.After(3.0, toggleFlush)
    C_Timer.After(5.0, toggleFlush)
end

local function pickChannelName()
    if WIMBridgeDB.channel and WIMBridgeDB.channel ~= "" then
        return WIMBridgeDB.channel
    end
    math.randomseed(GetServerTime() or time())
    local suffix = tostring(math.random(100000, 999999))
    local name = DEFAULT_CHANNEL_PREFIX .. suffix
    WIMBridgeDB.channel = name
    return name
end

local function joinRelayChannel()
    if not WIMBridgeDB.channelEnabled then return end
    local name = pickChannelName()
    state.channelName = name
    JoinTemporaryChannel(name)
    C_Timer.After(1, function()
        state.channelIndex = GetChannelName(name)
        if state.channelIndex and state.channelIndex > 0 then
            log("canal relay pronto: " .. name .. " (#" .. state.channelIndex .. ")")
        end
    end)
end

local function sendChannelRelay(kind, other, body)
    if not WIMBridgeDB.channelEnabled then return end
    if not state.channelIndex or state.channelIndex <= 0 then
        state.channelIndex = GetChannelName(state.channelName or "")
    end
    if not state.channelIndex or state.channelIndex <= 0 then return end
    local playerName = UnitName("player") or "unknown"
    local realm = (GetRealmName() or ""):gsub("%s+", "")
    local own = realm ~= "" and (playerName .. "-" .. realm) or playerName
    local ts = tostring(GetServerTime() or time())
    local payload = string.format("WIMRELAY<OWN:%s><%s:%s><TS:%s>%s", own, kind, other, ts, body or "")
    if #payload > 240 then payload = payload:sub(1, 240) end
    SendChatMessage(payload, "CHANNEL", nil, state.channelIndex)
    ensureChatLog()
    scheduleMultiFlush()
end

-- ---------------------------------------------------------------------------
-- TTS relay (rota B — nova, principal)
-- ---------------------------------------------------------------------------
local function spellName(name)
    if not name or name == "" then return "unknown" end
    local out = {}
    for i = 1, #name do
        local ch = name:sub(i, i)
        if ch == "-" then
            table.insert(out, "dash")
        elseif ch == " " then
            table.insert(out, "space")
        elseif ch:match("[A-Za-z]") then
            table.insert(out, string.upper(ch))
        elseif ch:match("[0-9]") then
            table.insert(out, ch)
        end
    end
    return table.concat(out, " ")
end

local function pickVoice()
    if state.voiceId ~= nil then return state.voiceId end
    if not C_VoiceChat or not C_VoiceChat.GetTtsVoices then return nil end
    local voices = C_VoiceChat.GetTtsVoices()
    if not voices or #voices == 0 then return nil end
    -- Preferir inglês porque soletração + "dash" é inambígua em inglês
    for _, v in ipairs(voices) do
        local name = (v.name or ""):lower()
        if name:find("english") or name:find("en%-") or name:find("zira") or name:find("david") or name:find("mark") then
            state.voiceId = v.voiceID
            return state.voiceId
        end
    end
    state.voiceId = voices[1].voiceID
    return state.voiceId
end

local function speakRelay(kind, other, body)
    if not WIMBridgeDB.ttsEnabled then return end
    if not C_VoiceChat or not C_VoiceChat.SpeakText then return end
    local voiceId = pickVoice()
    if voiceId == nil then return end
    local dest = 1 -- LocalPlayback
    if Enum and Enum.VoiceTtsDestination and Enum.VoiceTtsDestination.LocalPlayback then
        dest = Enum.VoiceTtsDestination.LocalPlayback
    end
    local prefix = (kind == "FROM") and "bridge from" or "bridge to"
    -- Sanitiza corpo: remove pontuações complicadas mantendo palavras
    local cleanBody = (body or ""):gsub("[\r\n\t]", " ")
    if #cleanBody > 200 then cleanBody = cleanBody:sub(1, 200) end
    local phrase = string.format("%s %s says %s end", prefix, spellName(other), cleanBody)
    -- Parar qualquer fala em andamento pra não engolir mensagem
    if C_VoiceChat.StopSpeakingText then
        pcall(C_VoiceChat.StopSpeakingText)
    end
    C_VoiceChat.SpeakText(voiceId, phrase, dest, WIMBridgeDB.ttsRate, WIMBridgeDB.ttsVolume)
end

-- ---------------------------------------------------------------------------
-- Event dispatch
-- ---------------------------------------------------------------------------
local function handleWhisper(kind, other, body)
    speakRelay(kind, other, body)          -- rota B
    sendChannelRelay(kind, other, body)    -- rota A (backup)
end

f:RegisterEvent("PLAYER_LOGIN")
f:RegisterEvent("PLAYER_ENTERING_WORLD")
f:RegisterEvent("CHAT_MSG_WHISPER")
f:RegisterEvent("CHAT_MSG_WHISPER_INFORM")
f:RegisterEvent("CHAT_MSG_BN_WHISPER")
f:RegisterEvent("CHAT_MSG_BN_WHISPER_INFORM")

f:SetScript("OnEvent", function(_, event, ...)
    if event == "PLAYER_LOGIN" or event == "PLAYER_ENTERING_WORLD" then
        ensureChatLog()
        C_Timer.After(2, joinRelayChannel)
        C_Timer.After(3, pickVoice)
        log("v" .. VERSION .. " iniciado. TTS=" .. tostring(WIMBridgeDB.ttsEnabled)
            .. " canal=" .. tostring(WIMBridgeDB.channelEnabled))
    elseif event == "CHAT_MSG_WHISPER" then
        local msg, sender = ...
        handleWhisper("FROM", sender or "unknown", msg or "")
    elseif event == "CHAT_MSG_WHISPER_INFORM" then
        local msg, target = ...
        handleWhisper("TO", target or "unknown", msg or "")
    elseif event == "CHAT_MSG_BN_WHISPER" then
        local msg, sender = ...
        handleWhisper("FROM", "bn:" .. tostring(sender or "unknown"), msg or "")
    elseif event == "CHAT_MSG_BN_WHISPER_INFORM" then
        local msg, target = ...
        handleWhisper("TO", "bn:" .. tostring(target or "unknown"), msg or "")
    end
end)

-- ---------------------------------------------------------------------------
-- Slash commands
-- ---------------------------------------------------------------------------
SLASH_WIMBRIDGE1 = "/wimbridge"
SLASH_WIMBRIDGE2 = "/wimb"
SlashCmdList["WIMBRIDGE"] = function(rawArgs)
    local args = (rawArgs or ""):lower():match("^%s*(.-)%s*$")
    local cmd, rest = args:match("^(%S+)%s*(.-)$")
    cmd = cmd or ""
    if cmd == "who" then
        local name = UnitName("player") or "?"
        local realm = GetRealmName() or "?"
        log("v" .. VERSION .. " · " .. name .. "-" .. realm)
    elseif cmd == "test" then
        handleWhisper("FROM", "Tester-Local", "hello world test " .. tostring(GetServerTime()))
        log("teste incoming enviado (TTS+canal).")
    elseif cmd == "testout" then
        handleWhisper("TO", "Tester-Local", "ok test")
        log("teste outgoing enviado.")
    elseif cmd == "log" then
        ensureChatLog()
        log("chatlog ligado.")
    elseif cmd == "flush" then
        toggleFlush()
        scheduleMultiFlush()
        log("multi-flush disparado.")
    elseif cmd == "channel" then
        log("canal relay: " .. tostring(state.channelName) .. " (#" .. tostring(state.channelIndex) .. ")")
    elseif cmd == "tts" then
        if rest == "on" then
            WIMBridgeDB.ttsEnabled = true
            log("TTS ligado.")
        elseif rest == "off" then
            WIMBridgeDB.ttsEnabled = false
            log("TTS desligado.")
        elseif rest == "test" then
            speakRelay("FROM", "Cbsies-Azralon", "hello world one two three")
            log("frase de teste TTS falada.")
        elseif rest:match("^rate ") then
            local n = tonumber(rest:match("^rate%s+(%-?%d+)"))
            if n then WIMBridgeDB.ttsRate = n; log("TTS rate = " .. n) end
        elseif rest:match("^volume ") then
            local n = tonumber(rest:match("^volume%s+(%d+)"))
            if n then WIMBridgeDB.ttsVolume = n; log("TTS volume = " .. n) end
        elseif rest == "voices" then
            local voices = C_VoiceChat and C_VoiceChat.GetTtsVoices() or {}
            log(#voices .. " vozes disponíveis:")
            for i, v in ipairs(voices) do
                log("  " .. i .. ". id=" .. tostring(v.voiceID) .. " · " .. tostring(v.name))
            end
        else
            log("tts on|off|test|voices|rate N|volume N · atual: " .. tostring(WIMBridgeDB.ttsEnabled))
        end
    elseif cmd == "chan" then
        if rest == "on" then WIMBridgeDB.channelEnabled = true; joinRelayChannel(); log("canal relay ligado.")
        elseif rest == "off" then WIMBridgeDB.channelEnabled = false; log("canal relay desligado.")
        else log("chan on|off · atual: " .. tostring(WIMBridgeDB.channelEnabled)) end
    else
        log("comandos: who | test | testout | log | flush | channel | tts ... | chan on|off")
    end
end
