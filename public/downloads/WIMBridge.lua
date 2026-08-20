-- WIMBridge v3.2.0 — OCR strip queue focused build
-- A faixa preta/amarela é o ÚNICO alvo de OCR em tempo real.
-- Cada janela do WoW tem sua própria fila local, então várias janelas funcionam
-- em paralelo sem misturar compradores/personagens.

WIMBRIDGE_VERSION = "3.2.0"
WIMBridgeDB = WIMBridgeDB or {}
if WIMBridgeDB.screenEnabled == nil then WIMBridgeDB.screenEnabled = true end
if WIMBridgeDB.stripHeight == nil then WIMBridgeDB.stripHeight = 140 end
if WIMBridgeDB.fontSize == nil then WIMBridgeDB.fontSize = 28 end
-- Tempo que cada mensagem fica visível para o OCR. Aceita decimal.
if WIMBridgeDB.stripDelay == nil then WIMBridgeDB.stripDelay = 1.6 end
if WIMBridgeDB.voiceEnabled == nil then WIMBridgeDB.voiceEnabled = false end
if WIMBridgeDB.combatEnabled == nil then WIMBridgeDB.combatEnabled = false end

local ownName = "Unknown"
local alive = { events = false, slash = false, whisperSeen = 0 }
local relayFrame, relayText = nil, nil
local relayQueue = {}
local relayBusy = false
local relaySeq = WIMBridgeDB.relaySeq or 0

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

local function clampMin(v, minValue, fallback)
    v = tonumber(v) or fallback
    if v < minValue then v = minValue end
    return v
end

local function applyVisualSettings()
    local h = clampMin(WIMBridgeDB.stripHeight, 30, 140)
    local fs = clampMin(WIMBridgeDB.fontSize, 8, 28)
    if relayFrame then relayFrame:SetHeight(h) end
    if relayText then
        local font = "Fonts\\FRIZQT__.TTF"
        pcall(function()
            local currentFont = relayText:GetFont()
            if currentFont then font = currentFont end
        end)
        pcall(function() relayText:SetFont(font, fs, "OUTLINE") end)
    end
end

local function ensureScreenFrame()
    if relayFrame or WIMBridgeDB.screenEnabled == false then return end
    pcall(function()
        relayFrame = CreateFrame("Frame", nil, UIParent, "BackdropTemplate")
        relayFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
        relayFrame:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", 0, 0)
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
        applyVisualSettings()
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

local function renderStrip(item)
    if WIMBridgeDB.screenEnabled == false then return end
    ensureScreenFrame()
    if not relayFrame or not relayText then return end

    local label = (item.kind == "in") and "FROM" or "TO"
    -- Formato propositalmente simples para OCR:
    -- BW 123 FROM Gasquatro-Azralon: mensagem
    local line = "BW " .. tostring(item.id) .. " " .. label .. " " .. sanitizeForOcr(item.other) .. ": " .. sanitizeForOcr(item.body)

    pcall(function()
        applyVisualSettings()
        relayText:SetText(line)
        relayFrame:Show()
    end)
end

local function nextQueuedStrip()
    if WIMBridgeDB.screenEnabled == false then
        relayBusy = false
        return
    end
    local item = table.remove(relayQueue, 1)
    if not item then
        relayBusy = false
        if relayFrame then relayFrame:Hide() end
        return
    end
    relayBusy = true
    renderStrip(item)
    local delay = tonumber(WIMBridgeDB.stripDelay) or 1.6
    if delay > 20 then delay = delay / 1000 end -- permite /wimbridge delay 1500
    if delay < 0.2 then delay = 0.2 end
    C_Timer.NewTimer(delay, function()
        if relayFrame then relayFrame:Hide() end
        C_Timer.NewTimer(0.05, nextQueuedStrip)
    end)
end

local function enqueueStrip(kind, other, body)
    relaySeq = relaySeq + 1
    WIMBridgeDB.relaySeq = relaySeq
    relayQueue[#relayQueue + 1] = {
        id = relaySeq,
        kind = kind,
        other = normalize(other),
        body = body or "",
    }
    if not relayBusy then nextQueuedStrip() end
end

local function relay(kind, other, body)
    computeOwnName()
    alive.whisperSeen = alive.whisperSeen + 1
    enqueueStrip(kind, other, body)

    pcall(function()
        if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
            DEFAULT_CHAT_FRAME:AddMessage("|cffffcc00WIMBridge OCR: " .. (kind == "in" and "FROM " or "TO ") .. normalize(other) .. " (#" .. tostring(relaySeq) .. ")|r", 1, 1, 0)
        end
    end)

    bigNotice("WIMBridge: " .. (kind == "in" and "recebido" or "enviado") .. " -> fila OCR")
end

local function showTest()
    enqueueStrip("in", "Teste-Azralon", "mensagem de teste da faixa OCR")
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
            print("|cffffcc00WIMBridge|r tamanho faixa = " .. tostring(WIMBridgeDB.stripHeight or 140) .. "px")
            print("|cffffcc00WIMBridge|r fonte faixa = " .. tostring(WIMBridgeDB.fontSize or 28) .. "px")
            print("|cffffcc00WIMBridge|r delay OCR = " .. tostring(WIMBridgeDB.stripDelay or 1.6) .. "s")
            print("|cffffcc00WIMBridge|r fila OCR = " .. tostring(#relayQueue) .. " pendente(s)")
        elseif cmd == "test" then
            showTest()
            print("|cffffcc00WIMBridge|r teste OCR enfileirado na faixa.")
        elseif cmd == "screen" then
            WIMBridgeDB.screenEnabled = not (WIMBridgeDB.screenEnabled ~= false)
            print("|cffffcc00WIMBridge|r faixa OCR " .. ((WIMBridgeDB.screenEnabled ~= false) and "LIGADA" or "DESLIGADA"))
        elseif cmd:match("^size%s+%d+") or cmd:match("^height%s+%d+") then
            local n = tonumber(cmd:match("(%d+)")) or 140
            n = math.max(30, n)
            WIMBridgeDB.stripHeight = n
            applyVisualSettings()
            print("|cffffcc00WIMBridge|r tamanho da faixa OCR = " .. tostring(n) .. "px")
            showTest()
        elseif cmd:match("^font%s+%d+") or cmd:match("^fontsize%s+%d+") or cmd:match("^fonte%s+%d+") then
            local n = tonumber(cmd:match("(%d+)")) or 28
            n = math.max(8, n)
            WIMBridgeDB.fontSize = n
            applyVisualSettings()
            print("|cffffcc00WIMBridge|r fonte da faixa OCR = " .. tostring(n) .. "px")
            showTest()
        elseif cmd:match("^delay%s+[%d%.]+") or cmd:match("^tempo%s+[%d%.]+") then
            local n = tonumber(cmd:match("([%d%.]+)")) or 1.6
            if n > 20 then n = n / 1000 end
            if n < 0.2 then n = 0.2 end
            WIMBridgeDB.stripDelay = n
            print("|cffffcc00WIMBridge|r delay da faixa OCR = " .. tostring(n) .. "s")
            showTest()
        else
            print("|cffffcc00WIMBridge|r " .. WIMBRIDGE_VERSION .. " | comandos: who | test | screen | size 140 | font 32 | delay 1.6")
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
