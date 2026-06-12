const path = require('path');
require('dotenv').config({ override: true, path: path.join(__dirname, '.env') });

const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');

const config = {
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_ID !== 'your_discord_application_client_id'
    ? process.env.DISCORD_CLIENT_ID
    : '1487380103984844941',
  guildId: process.env.DISCORD_GUILD_ID || null,
  adminUserIds: (process.env.DISCORD_ADMIN_USER_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID || null,
  supabaseUrl: process.env.SUPABASE_URL || 'https://qvedzrpljauuylbxgrkm.supabase.co',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
};

function maskKey(key) {
  if (!key) return '(missing)';
  if (key.length <= 12) return `${key.slice(0, 4)}...`;
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function requireConfig(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function generateRandomKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let index = 0; index < 32; index += 1) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function buildPremiumInsert(key) {
  return {
    key,
    key_type: 'premium',
    used: false,
    used_at: null,
    activated_device_id: null,
    activated_at: null,
  };
}

function isSchemaMismatchError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /used_at|activated_device_id|activated_at|column|schema|not null|null value/.test(message);
}

async function createPremiumKey() {
  requireConfig('SUPABASE_SERVICE_ROLE_KEY', config.supabaseKey);

  const key = generateRandomKey();

  const insertWithFallback = async body => {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/license_keys`, {
      method: 'POST',
      headers: {
        apikey: config.supabaseKey,
        Authorization: `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const message = `${response.status} ${text}`.trim();
      if (response.status === 401) {
        throw new Error(`Supabase rejected the service key. Double-check SUPABASE_SERVICE_ROLE_KEY in bot/.env. ${message}`.trim());
      }
      throw new Error(message);
    }
  };

  const insertBodies = [
    buildPremiumInsert(key),
    {
      key,
      key_type: 'premium',
      used: false,
      used_at: null,
    },
    {
      key,
      key_type: 'premium',
    },
  ];

  let lastError = null;
  for (const body of insertBodies) {
    try {
      await insertWithFallback(body);
      return key;
    } catch (error) {
      lastError = error;
      if (!isSchemaMismatchError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Failed to create premium key');
}

function isAuthorized(interaction) {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  if (config.adminUserIds.includes(interaction.user.id)) {
    return true;
  }

  if (config.adminRoleId && interaction.member?.roles?.cache?.has(config.adminRoleId)) {
    return true;
  }

  return false;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = [
  new SlashCommandBuilder()
    .setName('generate-premium-key')
    .setDescription('Generate premium license key(s) for a buyer')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('How many keys to generate')
        .setMinValue(1)
        .setMaxValue(20),
    )
    .addUserOption(option =>
      option
        .setName('recipient')
        .setDescription('Optional person to DM the key(s) to'),
    )
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log(`Registered guild commands for ${config.guildId}`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
  console.log('Registered global commands');
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName !== 'generate-premium-key') {
    return;
  }

  if (!isAuthorized(interaction)) {
    await interaction.reply({ content: 'You are not allowed to generate premium keys.', flags: MessageFlags.Ephemeral });
    return;
  }

  const amount = interaction.options.getInteger('amount') || 1;
  const recipient = interaction.options.getUser('recipient');

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (error) {
    if (error?.code === 10062) {
      console.warn('Skipped expired interaction before acknowledge.');
      return;
    }

    throw error;
  }

  try {
    const keys = [];
    for (let index = 0; index < amount; index += 1) {
      keys.push(await createPremiumKey());
    }

    const messageLines = keys.map((key, index) => `${index + 1}. ${key}`);
    const replyParts = [
      `Generated ${keys.length} premium key${keys.length === 1 ? '' : 's'}.`,
      '',
      ...messageLines,
    ];

    if (recipient) {
      replyParts.push('', `Recipient: ${recipient.tag}`);
    }

    await interaction.editReply({ content: replyParts.join('\n') });

    if (recipient) {
      try {
        await recipient.send({
          content: `Here are your premium key${keys.length === 1 ? '' : 's'}:\n\n${messageLines.join('\n')}`,
        });
      } catch (error) {
        console.warn(`Could not DM ${recipient.tag}:`, error.message || error);
      }
    }
  } catch (error) {
    console.error('Failed to generate premium key(s):', error);
    await interaction.editReply({ content: `Failed to generate premium key(s): ${error.message || error}` });
  }
});

async function main() {
  requireConfig('DISCORD_BOT_TOKEN', config.token);
  requireConfig('DISCORD_CLIENT_ID', config.clientId);
  requireConfig('SUPABASE_SERVICE_ROLE_KEY', config.supabaseKey);

  console.log(`Supabase project: ${config.supabaseUrl}`);
  console.log(`Supabase key: ${maskKey(config.supabaseKey)}`);

  if (!config.adminUserIds.length && !config.adminRoleId) {
    console.warn('No DISCORD_ADMIN_USER_IDS or DISCORD_ADMIN_ROLE_ID set. Only Discord server administrators will be able to issue keys.');
  }

  await registerCommands();
  await client.login(config.token);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});