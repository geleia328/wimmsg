local frame = CreateFrame("Frame")
local ownName = "Unknown"

local function normalize(name)
  if not name or name == "" then return "Unknown" end
  if string.find(name, "-", 1, true) then return name end
  local realm = GetNormalizedRealmName and GetNormalizedRealmName() or GetRealmName()
  return name .. "-" .. ((realm or "Unknown"):gsub("%s+", ""))
end

local function computeOwnName()
  local name, realm = UnitName("player")
  if name then
    if realm and realm ~= "" then
      ownName = normalize(name .. "-" .. realm)
    else
      ownName = normalize(name)
    end
  end
end

-- Emits: WIMRELAY<OWN:Char-Realm><FROM:Buyer-Realm><TS:unix>message
-- The bridge reads this line from WoWChatLog.txt (requires /chatlog).
local function emit(sender, message)
  local line = "WIMRELAY<OWN:" .. ownName ..
               "><FROM:" .. normalize(sender) ..
               "><TS:" .. tostring(time()) .. ">" .. (message or "")
  DEFAULT_CHAT_FRAME:AddMessage(line, 0.6, 0.6, 1.0)
end

frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHAT_MSG_WHISPER")
frame:RegisterEvent("CHAT_MSG_BN_WHISPER")
frame:SetScript("OnEvent", function(_, event, message, sender)
  if event == "PLAYER_LOGIN" then
    computeOwnName()
    return
  end
  if ownName == "Unknown" then computeOwnName() end
  emit(sender, message)
end)

SLASH_WIMBRIDGE1 = "/wimbridge"
SlashCmdList.WIMBRIDGE = function(arg)
  computeOwnName()
  if arg == "who" then
    print("WIMBridge: own = " .. ownName)
  else
    emit("Teste-Reino", "Mensagem de teste do WIMBridge")
    print("WIMBridge: linha de teste enviada ao chatlog.")
  end
end
