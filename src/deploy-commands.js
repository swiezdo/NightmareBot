import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

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
      .setDescription('Мастер настройки волн (только в личных сообщениях)'),
  ).toJSON(),
  gameOption(
    new SlashCommandBuilder()
      .setName('edit-waves')
      .setDescription('Редактировать сохранённые волны Tsushima из базы бота (ЛС)'),
  ).toJSON(),
  gameOption(
    new SlashCommandBuilder()
      .setName('waves')
      .setDescription(
        'Текущая ротация волн с nightmare.club (ЛС, allowlist). Tsushima — готово; Yōtei — пока нет.',
      ),
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
