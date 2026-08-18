-- WIMBridge (multi-window edition)
-- Captures received AND sent whispers and relays them into WoWChatLog.txt.
-- Uses a private relay channel because real channel messages are logged by
-- /chatlog. Some WoW clients buffer WoWChatLog.txt until logout, so this addon
-- performs delayed multi-flush after every relay message.

local f = CreateFrame("Frame")
f:RegisterEvent("CHAT_MSG_WHISPER")
f:RegisterEvent("CHAT_MSG_WHISPER_INFORM")
f:RegisterEvent("CHAT_MSG_BN_WHISPER")
f:RegisterEvent("CHAT_MSG_BN_WHISPER_INFORM")
f:RegisterEvent("PLAYER_LOGIN")
f:RegisterEvent("PLAYER_ENTERING_WORLD")

WIMBridgeDB = WIMBridgeDB or {}

local ownName = "Unknown"
local chatLoggingEnabled = false
local relayChannelName = nil
local relayChannelId = nil
local flushGeneration = 0

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
    -- Force WoW to close and reopen the chatlog writer.
    -- We intentionally run this DELAYED after the relay channel message,
    -- because the server/channel line can take a moment to be written to the
    -- internal chat buffer. Flushing too early does nothing.
    if not LoggingChat then return end
    pcall(function() LoggingChat(false) end)
    C_Timer.After(0.35, function()
        pcall(function() LoggingChat(true) end)
        chatLoggingEnabled = true
        if label then
            -- Keep this visible but short for debugging.
            print("|cff88ff88WIMBridge|r flush " .. label)
        end
    end)
end

local function scheduleMultiFlush()
    flushGeneration = flushGeneration + 1
    local gen = flushGeneration
    -- Multi-stage flush: if the channel message lands late in WoW's buffer,
    -- a later flush still catches it. This is the key fix for "only appears
    -- after closing the WoW window".
    C_Timer.After(1.5, function()
        if gen == flushGeneration then forceFlush("1/3") end
    end)
    C_Timer.After(3.0, function()
        if gen == flushGeneration then forceFlush("2/3") end
    end)
    C_Timer.After(5.0, function()
        if gen == flushGeneration then forceFlush("3/3") end
    end)
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
    if id and id > 0 then
        relayChannelId = id
        return true
    end

    pcall(function() JoinTemporaryChannel(relayChannelName) end)
    id = GetChannelName(relayChannelName)
    if id and id > 0 then
        relayChannelId = id
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

local function relay(line)
    enableChatLog(true)
    echoVisible(line)

    if ensureRelayChannel() and relayChannelId then
        if #line > 240 then line = line:sub(1, 240) end
        pcall(function() SendChatMessage(line, "CHANNEL", nil, relayChannelId) end)
        scheduleMultiFlush()
    else
        print("|cffff5555WIMBridge|r não conseguiu entrar no canal relay; usando apenas echo visual.")
    end
end

f:SetScript("OnEvent", function(_, event, msg, target)
    if event == "PLAYER_LOGIN" or event == "PLAYER_ENTERING_WORLD" then
        computeOwnName()
        enableChatLog(false)
        C_Timer.After(2, ensureRelayChannel)
        return
    end

    if ownName == "Unknown" then computeOwnName() end
    enableChatLog(true)
    ensureRelayChannel()

    if event == "CHAT_MSG_WHISPER" or event == "CHAT_MSG_BN_WHISPER" then
        local from = normalize(target)
        relay(string.format("WIMRELAY<OWN:%s><FROM:%s><TS:%s>%s", ownName, from, time(), msg or ""))
        return
    end

    if event == "CHAT_MSG_WHISPER_INFORM" or event == "CHAT_MSG_BN_WHISPER_INFORM" then
        local to = normalize(target)
        relay(string.format("WIMRELAY<OWN:%s><TO:%s><TS:%s>%s", ownName, to, time(), msg or ""))
        return
    end
end)

SLASH_WIMBRIDGE1 = "/wimbridge"
SlashCmdList["WIMBRIDGE"] = function(cmd)
    computeOwnName()
    enableChatLog(false)
    ensureRelayChannel()
    if cmd == "test" then
        relay(string.format("WIMRELAY<OWN:%s><FROM:TestPlayer-TestRealm><TS:%s>hello world", ownName, time()))
    elseif cmd == "testout" then
        relay(string.format("WIMRELAY<OWN:%s><TO:TestPlayer-TestRealm><TS:%s>outgoing hello", ownName, time()))
    elseif cmd == "who" then
        print("|cffffcc00WIMBridge|r own = " .. ownName)
        print("|cffffcc00WIMBridge|r relay = " .. (relayChannelName or "not-ready"))
    elseif cmd == "log" then
        enableChatLog(false)
        forceFlush("manual")
        print("|cffffcc00WIMBridge|r /chatlog solicitado e flush executado.")
    elseif cmd == "flush" then
        forceFlush("manual")
        print("|cffffcc00WIMBridge|r flush do chatlog solicitado.")
    elseif cmd == "channel" then
        print("|cffffcc00WIMBridge|r relay channel = " .. (relayChannelName or "not-ready"))
    else
        print("|cffffcc00WIMBridge|r comandos: /wimbridge test | testout | who | log | flush | channel")
    end
end

print("|cffffcc00WIMBridge|r carregado. Relay privado + multi-flush do WoWChatLog ativos.")
