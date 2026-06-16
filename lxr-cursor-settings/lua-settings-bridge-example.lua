--[[
  LXR Cursor Settings — Minimal working Lua bridge (client + server)
  Drop/adapt into your lxr-medic (or any LXR resource).

  Flow:
  - Admin opens settings → client asks server → server sends full config + locale via NUI
  - User changes a value → live 'settings:update' → server applies + can broadcast
  - User hits "Apply & Save" → 'settings:save' → server persists the whole blob
  - Other admins get live updates via 'settings:apply'
]]

-- =========================
-- SERVER (put in server/*.lua or a dedicated settings.lua)
-- =========================
local SETTINGS = {} -- in-memory cache; persist to DB/KVP/oxmysql as you like

-- TODO: implement real load/save with your DB
local function LoadSettings()
  -- Example with oxmysql (recommended):
  -- local result = MySQL.Sync.fetchScalar('SELECT data FROM lxr_settings WHERE resource = ?', {'lxr-medic'})
  -- return result and json.decode(result) or GetDefaultSettings()
  return SETTINGS.lxr_medic or GetDefaultSettings()
end

local function SaveSettings(cfg)
  SETTINGS.lxr_medic = cfg
  -- MySQL.Async.execute('REPLACE INTO lxr_settings (resource, data) VALUES (?, ?)', {'lxr-medic', json.encode(cfg)})
end

function GetDefaultSettings()
  return {
    enabled = true,
    requireJob = true,
    callKey = 'G',
    lastStandDuration = 120,
    bleedRate = 1.0,
    reviveTime = 8,
    npcDoctorEnabled = true,
    npcWaitBase = 90,
    billingEnabled = true,
    basePrice = 250,
    chargeOnSave = true,
    maxBill = 2500,
    downedHudStyle = 'center',
    showProgressBar = true,
    notifyStyle = 'ox',
    keyCallMedic = 'G',
    keyQuickDiagnose = 'E',
    keyOpenBoss = 'F6',
    allowSelfRevive = false,
    debugLogs = false,
    staggerNui = 70,
  }
end

-- Admin check (adapt to your framework / ACE)
local function IsAdmin(src)
  -- Example: return IsPlayerAceAllowed(src, 'lxr-medic.admin') or has framework admin group
  return true -- TODO: replace with real check
end

RegisterCommand('medsettings', function(src)
  if not IsAdmin(src) then return end
  local cfg = LoadSettings()
  -- You can also send a locale table here (nui_ keys etc.)
  TriggerClientEvent('lxr-medic:settings:open', src, cfg, {})
end, false)

RegisterNetEvent('lxr-medic:settings:save', function(newCfg)
  local src = source
  if not IsAdmin(src) then return end
  SaveSettings(newCfg)
  -- Live push to everyone who might have the panel open
  TriggerClientEvent('lxr-medic:settings:apply', -1, newCfg)
end)

RegisterNetEvent('lxr-medic:settings:update', function(key, value)
  local src = source
  if not IsAdmin(src) then return end
  local cfg = LoadSettings()
  cfg[key] = value
  SaveSettings(cfg)
  -- Optional: broadcast single key change
  TriggerClientEvent('lxr-medic:settings:apply', -1, cfg)
end)

-- =========================
-- CLIENT (put in client/*.lua or a settings client file)
-- =========================
local resourceName = GetCurrentResourceName()

-- Open the Cursor settings panel
RegisterNetEvent('lxr-medic:settings:open', function(config, locale)
  SendNUIMessage({
    action = 'openSettings',
    config = config,
    locale = locale or {}
  })
  SetNuiFocus(true, true)
end)

-- Server pushed new values (multi-admin or external change)
RegisterNetEvent('lxr-medic:settings:apply', function(config)
  SendNUIMessage({
    action = 'settings:apply',
    config = config
  })
end)

-- NUI Callbacks (must match what lxr-settings.js posts)
RegisterNUICallback('settings:update', function(data, cb)
  TriggerServerEvent('lxr-medic:settings:update', data.key, data.value)
  cb({})
end)

RegisterNUICallback('settings:save', function(data, cb)
  TriggerServerEvent('lxr-medic:settings:save', data.config)
  cb({})
end)

RegisterNUICallback('settings:close', function(data, cb)
  SetNuiFocus(false, false)
  cb({})
end)

-- Optional helper: your admin UI or a header button can call this
-- exports or just TriggerServerEvent if you want the server to decide the config
RegisterNUICallback('settings:requestOpen', function(_, cb)
  TriggerServerEvent('lxr-medic:settings:requestOpen')
  cb({})
end)

-- If you want the server to push the open when it receives the request:
-- RegisterNetEvent('lxr-medic:settings:requestOpen', function()
--   local src = source
--   if not IsAdmin(src) then return end
--   TriggerClientEvent('lxr-medic:settings:open', src, LoadSettings(), {})
-- end)

print('^2[LXR] Cursor Settings bridge loaded^0')
