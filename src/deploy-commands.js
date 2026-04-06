import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('Нужны DISCORD_TOKEN и CLIENT_ID в .env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup-waves')
    .setDescription('Мастер настройки волн (только в личных сообщениях)')
    .addStringOption((option) =>
      option
        .setName('game')
        .setDescription('Игра')
        .setRequired(true)
        .addChoices(
          { name: 'Ghost of Tsushima', value: 'tsushima' },
          { name: 'Ghost of Yotei', value: 'yotei' },
        ),
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log('Глобальные команды зарегистрированы.');
