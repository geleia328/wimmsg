local frame = CreateFrame("Frame")
local ownName = "Unknown"
local function normalize(name)
  if not name or name == "" then return "Unknown" end
  if string.find(name, "-", 1, true) then return name end
  local realm = GetNormalizedRealmName and GetNormalizedRealmName() or GetRealmName()
  return name .. "-" .. (realm or "Unknown"):gsub("%s+", "")
end
local function computeOwnName()
  local name, realm = UnitName("player")
  if name then ownName = normalize(realm and realm ~= "" and (name .. "-" .. realm) or name) end
end
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHAT_MSG_WHISPER")
frame:RegisterEvent("CHAT_MSG_BN_WHISPER")
frame:SetScript("OnEvent", function(_, event, message, sender)
  if event == "PLAYER_LOGIN" then computeOwnName() return end
  if ownName == "Unknown" then computeOwnName() end
  local line = "WIMRELAY<OWN:" .. ownName .. "><FROM:" .. normalize(sender) .. "><TS:" .. tostring(time()) .. ">" .. (message or "")
  DEFAULT_CHAT_FRAME:AddMessage(line, 1.0, 0.75, 0.0)
end)
SLASH_WIMBRIDGE1 = "/wimbridge"
SlashCmdList.WIMBRIDGE = function(arg)
  computeOwnName()
  if arg == "who" then print("WIMBridge: " .. ownName) else print("[WIMBRIDGE]<OWN:" .. ownName .. "><FROM:Teste-Reino>Mensagem de teste") end
end
