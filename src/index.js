import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { handleSetupWavesInteraction, parseAllowedUserIds } from './handlers/setup-waves.js';
import { handleBulkWavesDmMessage } from './handlers/bulk-waves-message.js';
import { initDatabase } from './db/database.js';

initDatabase();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Задайте DISCORD_TOKEN в .env');
  process.exit(1);
}

const debugWs = process.env.WAVES_BOT_DEBUG === '1' || process.env.WAVES_BOT_DEBUG === 'true';

const allowed = parseAllowedUserIds(process.env.SETUP_WAVES_ALLOWED_USER_IDS);
if (allowed.size === 0) {
  console.warn('SETUP_WAVES_ALLOWED_USER_IDS пуст — команду никто не вызовет.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
  presence: { status: 'online' },
});

if (debugWs) {
  client.on(Events.Debug, (msg) => {
    if (typeof msg === 'string' && /token/i.test(msg)) return;
    console.log('[DiscordDebug]', msg);
  });
}

client.on(Events.ShardDisconnect, (evt, shardId) => {
  console.warn(`[WS] shard ${shardId} disconnect code=${evt?.code} reason=${evt?.reason ?? ''}`);
});

client.on(Events.ShardResume, (shardId, replayed) => {
  console.log(`[WS] shard ${shardId} resume, replayed=${replayed}`);
});

client.on(Events.Error, (err) => {
  console.error('[ClientError]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Готов: ${c.user.tag} (waves-bot)`);
  try {
    await c.user?.setPresence({ status: 'online' });
  } catch (e) {
    console.warn('[Presence] не удалось выставить online:', e);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleBulkWavesDmMessage(message);
  } catch (err) {
    console.error('MessageCreate (bulk waves)', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (
      interaction.isChatInputCommand() &&
      (interaction.commandName === 'setup-waves' || interaction.commandName === 'edit-waves')
    ) {
      await handleSetupWavesInteraction(interaction, client);
      return;
    }
    if (interaction.isMessageComponent()) {
      if (
        interaction.customId?.startsWith('waves:') &&
        (interaction.isButton() || interaction.isStringSelectMenu())
      ) {
        await handleSetupWavesInteraction(interaction, client);
      }
    }
  } catch (err) {
    console.error('InteractionCreate', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'Ошибка. Смотрите логи.', ephemeral: true });
      } catch {
        /* ignore */
      }
    }
  }
});

await client.login(token);
