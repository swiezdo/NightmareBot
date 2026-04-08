import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, ApplicationIntegrationType } from 'discord.js';

/** Мастер: только user install (ЛС / «приложение на аккаунт»), не спамим список слэшей на серверах. */
const USER_INSTALL_ONLY = [ApplicationIntegrationType.UserInstall];
/** /waves: только гильдии (каналы сервера). */
const GUILD_INSTALL_ONLY = [ApplicationIntegrationType.GuildInstall];

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('Нужны DISCORD_TOKEN и CLIENT_ID в .env');
  process.exit(1);
}

const gameOption = (builder) =>
  builder.addStringOption((option) =>
    option
      .setName('game')
      .setDescription('Игра')
      .setRequired(true)
      .addChoices(
        { name: 'Ghost of Tsushima', value: 'tsushima' },
        { name: 'Ghost of Yotei', value: 'yotei' },
      ),
  );

const commands = [
  gameOption(
    new SlashCommandBuilder()
      .setName('setup-waves')
      .setDescription('Мастер настройки волн (только в личных сообщениях)')
      .setIntegrationTypes(...USER_INSTALL_ONLY),
  ).toJSON(),
  gameOption(
    new SlashCommandBuilder()
      .setName('edit-waves')
      .setDescription('Редактировать сохранённые волны Tsushima из базы бота (ЛС)')
      .setIntegrationTypes(...USER_INSTALL_ONLY),
  ).toJSON(),
  gameOption(
    new SlashCommandBuilder()
      .setName('waves')
      .setDescription(
        'Ротация волн nightmare.club (Tsushima/Yōtei). Канал сервера, allowlist, язык en/ru.',
      )
      .setIntegrationTypes(...GUILD_INSTALL_ONLY),
  )
    .addStringOption((option) =>
      option
        .setName('lang')
        .setDescription('Язык вывода / Output language')
        .setRequired(true)
        .addChoices(
          { name: 'English', value: 'en' },
          { name: 'Русский', value: 'ru' },
        ),
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log('Глобальные команды зарегистрированы.');
