import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder, ApplicationIntegrationType } from 'discord.js';

/** Guild-scoped slash commands; setup/edit are meant for DMs (ephemeral hint if used on a server). */
const GUILD_INSTALL_ONLY = [ApplicationIntegrationType.GuildInstall];

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('Need DISCORD_TOKEN and CLIENT_ID in .env');
  process.exit(1);
}

const gameOption = (builder) =>
  builder.addStringOption((option) =>
    option
      .setName('game')
      .setDescription('Game')
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
      .setDescription('Waves setup wizard. Use in DMs only.')
      .setIntegrationTypes(...GUILD_INSTALL_ONLY),
  ).toJSON(),
  gameOption(
    new SlashCommandBuilder()
      .setName('edit-waves')
      .setDescription('Edit current waves from Nightmare.Club. DMs only.')
      .setIntegrationTypes(...GUILD_INSTALL_ONLY),
  ).toJSON(),
  gameOption(
    new SlashCommandBuilder()
      .setName('waves')
      .setDescription(
        'Nightmare.Club wave rotation (Tsushima/Yōtei). Guild or DM; choose English or Russian output.',
      )
      .setIntegrationTypes(...GUILD_INSTALL_ONLY),
  )
    .addStringOption((option) =>
      option
        .setName('lang')
        .setDescription('Output language for the rotation text')
        .setRequired(true)
        .addChoices(
          { name: 'English', value: 'en' },
          { name: 'Russian', value: 'ru' },
        ),
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log('Global application commands registered.');
