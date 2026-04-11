import { MessageFlags } from 'discord.js';
import { t } from '../i18n/strings.js';
import {
  addSetupAllowlistUser,
  listSetupAllowlistUsers,
  removeSetupAllowlistUser,
} from '../db/setup-allowlist.js';
import { isWhitelistManager, parseManagerUserIds } from '../utils/setup-access.js';

const EPHEMERAL = MessageFlags.Ephemeral;

/** @param {import('discord.js').ChatInputCommandInteraction} interaction */
function cmdLocale(interaction) {
  return String(interaction.locale ?? '').startsWith('ru') ? 'ru' : 'en';
}

/**
 * @param {import('discord.js').User} u
 */
function userDisplay(u) {
  if (u.globalName) return `${u.globalName} (${u.username})`;
  return u.username;
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').Client} client
 */
export async function handleWhitelistCommand(interaction, client) {
  const loc = cmdLocale(interaction);

  if (!isWhitelistManager(interaction.user.id)) {
    if (interaction.replied || interaction.deferred) return;
    await interaction.reply({ content: t(loc, 'whitelist_forbidden'), flags: EPHEMERAL });
    return;
  }

  const name = interaction.commandName;

  if (name === 'whitelist-add') {
    const target = interaction.options.getUser('user', true);
    if (target.bot) {
      await interaction.reply({ content: t(loc, 'whitelist_add_bot'), flags: EPHEMERAL });
      return;
    }
    const display = userDisplay(target);
    const { inserted } = addSetupAllowlistUser(target.id, display, interaction.user.id);
    if (!inserted) {
      await interaction.reply({ content: t(loc, 'whitelist_add_dup'), flags: EPHEMERAL });
      return;
    }
    await interaction.reply({
      content: t(loc, 'whitelist_add_ok').replace('{tag}', display).replace('{id}', target.id),
      flags: EPHEMERAL,
    });
    return;
  }

  if (name === 'whitelist-remove') {
    const target = interaction.options.getUser('user', true);
    const ok = removeSetupAllowlistUser(target.id);
    if (!ok) {
      await interaction.reply({ content: t(loc, 'whitelist_remove_missing'), flags: EPHEMERAL });
      return;
    }
    const display = userDisplay(target);
    await interaction.reply({
      content: t(loc, 'whitelist_remove_ok').replace('{tag}', display).replace('{id}', target.id),
      flags: EPHEMERAL,
    });
    return;
  }

  if (name === 'whitelist-show') {
    await interaction.deferReply({ flags: EPHEMERAL });

    const managers = parseManagerUserIds(process.env.ALLOWED_USER_IDS);
    const rows = listSetupAllowlistUsers();

    /** @type {string[]} */
    const lines = [];
    lines.push(t(loc, 'whitelist_show_header_managers'));
    if (managers.size === 0) {
      lines.push('—');
    } else {
      for (const id of managers) {
        let u = null;
        try {
          u = await client.users.fetch(id);
        } catch {
          /* unknown user */
        }
        const tag = u ? userDisplay(u) : `(${id})`;
        lines.push(t(loc, 'whitelist_show_line').replace('{tag}', tag).replace('{id}', id));
      }
    }

    lines.push('');
    lines.push(t(loc, 'whitelist_show_header_db'));
    if (rows.length === 0) {
      lines.push('—');
    } else {
      for (const r of rows) {
        lines.push(
          t(loc, 'whitelist_show_line').replace('{tag}', r.display_name).replace('{id}', r.user_id),
        );
      }
    }

    let text = lines.join('\n');
    const max = 1900;
    if (text.length > max) {
      text = `${text.slice(0, max)}${t(loc, 'whitelist_show_truncated')}`;
    }

    await interaction.editReply({ content: text });
  }
}
