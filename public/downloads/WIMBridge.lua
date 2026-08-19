-- WIMBridge v3.0.0 — OCR strip focused build
-- Objetivo: mostrar uma faixa grande, limpa e exclusiva para OCR em tempo real.
-- O bridge deve ler SOMENTE essa faixa, ignorando chat normal/anúncios.

WIMBRIDGE_VERSION = "3.0.0"
WIMBridgeDB = WIMBridgeDB or {}
if WIMBridgeDB.screenEnabled == nil then WIMBridgeDB.screenEnabled = true end
if WIMBridgeDB.voiceEnabled == nil then WIMBridgeDB.voiceEnabled = false end
if WIMBridgeDB.combatEnabled == nil then WIMBridgeDB.combatEnabled = false end

local ownName = "Unknown"
local alive = { events = false, slash = false, whisperSeen = 0 }
local relayFrame, relayText, relayTimer = nil, nil, nil

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

local function bigNotice(text)
    pcall(function()
        RaidNotice_AddMessage(RaidWarningFrame, text, ChatTypeInfo["RAID_WARNING"])
    end)
end

local function ensureChatLog()
    pcall(function() LoggingChat(true) end)
end

local function ensureScreenFrame()
    if relayFrame or WIMBridgeDB.screenEnabled == false then return end
    pcall(function()
        relayFrame = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
        relayFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
        relayFrame:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", 0, 0)
        relayFrame:SetHeight(92)
        relayFrame:SetBackdrop({ bgFile = "Interface/Tooltips/UI-Tooltip-Background" })
        relayFrame:SetBackdropColor(0, 0, 0, 1.0)
        relayFrame:SetFrameStrata("FULLSCREEN_DIALOG")
        relayFrame:SetFrameLevel(9999)

        relayText = relayFrame:CreateFontString(nil, "OVERLAY", "GameFontNormalHuge")
        relayText:SetPoint("LEFT", relayFrame, "LEFT", 8, 0)
        relayText:SetPoint("RIGHT", relayFrame, "RIGHT", -8, 0)
        relayText:SetJustifyH("LEFT")
        relayText:SetJustifyV("MIDDLE")
        relayText:SetTextColor(1, 0.92, 0, 1)
        relayText:SetShadowColor(0, 0, 0, 1)
        relayText:SetShadowOffset(2, -2)
        relayFrame:Hide()
    end)
end

local function sanitizeForOcr(s)
    s = tostring(s or "")
    s = s:gsub("|c%x%x%x%x%x%x%x%x", "")
    s = s:gsub("|r", "")
    s = s:gsub("|H.-|h", "")
    s = s:gsub("|h", "")
    s = s:gsub("[\r\n]+", " ")
    s = s:gsub("%s+", " ")
    if #s > 180 then s = s:sub(1, 180) end
    return s
end

local function showScreen(kind, other, body)
    if WIMBridgeDB.screenEnabled == false then return end
    ensureScreenFrame()
    if not relayFrame or not relayText then return end

    -- Formato propositalmente humano e curto para OCR:
    -- BW FROM Gasquatro-Azralon: testando no game
    -- O bridge usa a JANELA como own character, então não precisamos desenhar OWN.
    -- Isso reduz erro de OCR e evita que WIMRELAY quebrado caia no site.
    local label = (kind == "in") and "FROM" or "TO"
    local line = "BW " .. label .. " " .. sanitizeForOcr(other) .. ": " .. sanitizeForOcr(body)

    pcall(function()
        relayText:SetText(line)
        relayFrame:Show()
        if relayTimer then relayTimer:Cancel() end
        relayTimer = C_Timer.NewTimer(8, function()
            if relayFrame then relayFrame:Hide() end
        end)
    end)
end

local function relay(kind, other, body)
    computeOwnName()
    other = normalize(other)
    body = body or ""
    alive.whisperSeen = alive.whisperSeen + 1

    -- A faixa OCR é o caminho principal.
    showScreen(kind, other, body)

    -- Mantemos echo visual simples para diagnóstico dentro do WoW.
    pcall(function()
        if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
            DEFAULT_CHAT_FRAME:AddMessage("|cffffcc00WIMBridge OCR: " .. (kind == "in" and "FROM " or "TO ") .. other .. "|r", 1, 1, 0)
        end
    end)

    bigNotice("WIMBridge: " .. (kind == "in" and "recebido" or "enviado") .. " -> OCR")
end

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
            print("|cffffcc00WIMBridge|r OCR faixa = " .. tostring(WIMBridgeDB.screenEnabled ~= false))
        elseif cmd == "test" then
            showScreen("in", "Teste-Azralon", "mensagem de teste da faixa OCR")
            print("|cffffcc00WIMBridge|r teste OCR exibido na faixa.")
        elseif cmd == "screen" then
            WIMBridgeDB.screenEnabled = not (WIMBridgeDB.screenEnabled ~= false)
            print("|cffffcc00WIMBridge|r faixa OCR " .. ((WIMBridgeDB.screenEnabled ~= false) and "LIGADA" or "DESLIGADA"))
        else
            print("|cffffcc00WIMBridge|r " .. WIMBRIDGE_VERSION .. " | comandos: who | test | screen")
        end
    end
    alive.slash = true
end)

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
            ensureScreenFrame()
            alive.events = true
            bigNotice("WIMBridge " .. WIMBRIDGE_VERSION .. " ATIVO")
            return
        end
        if ownName == "Unknown" then computeOwnName() end
        ensureChatLog()
        if event == "CHAT_MSG_WHISPER" or event == "CHAT_MSG_BN_WHISPER" then
            relay("in", target, msg or "")
        elseif event == "CHAT_MSG_WHISPER_INFORM" or event == "CHAT_MSG_BN_WHISPER_INFORM" then
            relay("out", target, msg or "")
        end
    end)
    alive.events = true
end)

print("|cffffcc00WIMBridge|r v" .. WIMBRIDGE_VERSION .. " carregado. Digite /wimbridge who para confirmar.")
