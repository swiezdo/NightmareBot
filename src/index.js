import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { handleSetupWavesInteraction } from './handlers/setup-waves.js';
import { handleWhitelistCommand } from './handlers/whitelist-command.js';
import { parseManagerUserIds } from './utils/setup-access.js';
import { handleWavesCommand } from './handlers/waves-command.js';
import { handleBulkWavesDmMessage } from './handlers/bulk-waves-message.js';
import { initDatabase } from './db/database.js';

initDatabase();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Задайте DISCORD_TOKEN в .env');
  process.exit(1);
}

const debugWs = process.env.WAVES_BOT_DEBUG === '1' || process.env.WAVES_BOT_DEBUG === 'true';

const managers = parseManagerUserIds(process.env.ALLOWED_USER_IDS);
if (managers.size === 0) {
  console.warn(
    'ALLOWED_USER_IDS пуст — команды /whitelist-* недоступны; /setup-waves и /edit-waves только у кого есть строка в таблице waves_setup_allowlist (или вручную в БД). /waves без ограничений.',
  );
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
      (interaction.commandName === 'whitelist-add' ||
        interaction.commandName === 'whitelist-remove' ||
        interaction.commandName === 'whitelist-show')
    ) {
      await handleWhitelistCommand(interaction, client);
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'waves') {
      await handleWavesCommand(interaction);
      return;
    }
    if (
      interaction.isChatInputCommand() &&
      (interaction.commandName === 'setup-waves' || interaction.commandName === 'edit-waves')
    ) {
      await handleSetupWavesInteraction(interaction, client);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('waves:credits_modal')) {
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
        await interaction.reply({
          content: 'Ошибка. Смотрите логи.',
          ephemeral: interaction.inGuild(),
        });
      } catch {
        /* ignore */
      }
    }
  }
});

await client.login(token);
