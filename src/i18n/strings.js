/** @type {Record<'en' | 'ru', Record<string, string>>} */
export const strings = {
  en: {
    choose_language_line: 'Choose your language / Выбери свой язык',
    btn_english: 'English',
    btn_russian: 'Русский',
    choose_week: 'Select week:',
    choose_wave: 'Choose wave (slot):',
    choose_zone: 'Choose zone:',
    choose_spawn: 'Choose spawn:',
    btn_done: 'Done',
    forbidden: 'You are not allowed to use this command.',
    dm_only:
      'This command only works in direct messages. Open a DM with the bot and run it there.',
    game_not_available: 'This game is not available in the editor yet.',
    saved_success: 'Saved to the bot database (SQLite).',
    saved_success_api: 'Published to Nightmare.Club.',
    api_not_configured:
      'Nightmare.Club API is not configured. Set **NIGHTMARE_CLUB_TSUSHIMA_URL** and **NIGHTMARE_CLUB_TSUSHIMA_TOKEN** in `.env` (same token as `BOT_API_TOKEN_TSUSHIMA` on the site).',
    api_payload_error: 'Internal error building the API payload. Check logs.',
    api_network_error: 'Network error while calling Nightmare.Club. Try again later.',
    api_publish_failed_prefix: 'Nightmare.Club rejected the publish:',
    api_week_line: 'Site week (week_start): **{week}**',
    grid_incomplete: 'The wave grid is not complete yet.',
    setup_reset: 'Starting over. Use the buttons below.',
    edit_panel_reopened: 'Edit session: panel updated below.',
    week_prefix: 'Map:',
    all_filled_hint: 'All wave slots are filled. Press **Done** to save.',
    confirm_saved: 'You can run `/setup-waves` or `/edit-waves` again.',
    session_stale: 'Session expired or missing. Run `/setup-waves` or `/edit-waves` again.',
    session_expired_idle:
      'Session expired (no activity for one hour). Run `/setup-waves` or `/edit-waves` to open a new panel.',
    wizard_message_deleted:
      'The wizard message was deleted or is no longer available. Run `/setup-waves` or `/edit-waves` again to open a new panel.',
    grid_page: 'Page {cur}/{tot}',
    btn_prev: 'Back',
    btn_next: 'Next',
    week_code_label: 'Week {code}',
    mods_prefix: 'Mods:',
    wave_spawn_header: 'Wave {wave} - Spawn {wave}.{slot}',
    zone_line_prefix: 'Zone:',
    btn_wizard_back: 'Back',
    edit_tsushima_missing:
      'No Tsushima rotation for the current site week (empty API `maps`). Publish from `/setup-waves` first or check Nightmare.Club.',
    edit_tsushima_invalid:
      'Could not build the editor draft from the Nightmare.Club response (bad or unexpected JSON).',
    edit_tsushima_week_unknown:
      'This `week_code` from the site is not in `json/rotation_tsushima_*.json`. Update the rotation JSON files in the bot and redeploy.',
    edit_tsushima_multi_map_note:
      'Note: the API returned several maps for this week; the editor opened the **first** entry.',
    week_not_in_rotation:
      'This **week** is not in the current rotation JSON. Run `/setup-waves` to pick a valid week or fix stored data.',
    week_select_failed: 'That week is no longer in rotation. Pick another one below.',
    invalid_wave_slot: 'Invalid wave slot.',
    bulk_intro: '',
    bulk_spawn_names_header: 'Use only these spawn names (zone + spawn, or zone only if there is a single spawn):',
    bulk_format_header: 'Format (one line per wave, three slots separated by commas):',
    bulk_format_and_so_on: 'and so on',
    bulk_reply_hint: 'Send your list as a **reply** to this message.',
    bulk_cancel: 'Cancel',
    bulk_err_bad_line: 'This line does not match `N. slot, slot, slot`:',
    bulk_err_bad_wave_num: 'Invalid wave number (must be 1–15).',
    bulk_err_dup_wave: 'Duplicate wave number:',
    bulk_err_bad_slot_count: 'Wave {wave}: need exactly three comma-separated slots.',
    bulk_err_missing_waves: 'Need 15 lines, waves 1–15, each with three slots.',
    bulk_err_bad_slots: 'Unknown labels (marked **bold** below). Fix and send the list again:',
    bulk_err_unknown: 'Could not parse the list.',
    credits_modal_title: 'Credits',
    credits_modal_label: 'Credits (thanks / attribution)',
    credits_modal_placeholder: 'Optional — leave empty for the default line.',
    waves_read_401:
      'Nightmare.Club returned **401**: check **NIGHTMARE_CLUB_TSUSHIMA_TOKEN** in `.env` (must match `BOT_API_TOKEN_TSUSHIMA` on the site).',
    waves_read_http: 'Failed to load Tsushima rotation: HTTP **{status}**.',
    waves_read_timeout: 'Nightmare.Club API timed out. Try again later.',
    waves_read_network: 'Network error while loading Tsushima rotation. Try again later.',
    waves_yotei_api_not_configured:
      'Yōtei read API is not configured. Set **NIGHTMARE_CLUB_YOTEI_TOKEN** in `.env` (same token as **`BOT_API_TOKEN_YOTEI`** on Nightmare.Club). Optional: **NIGHTMARE_CLUB_YOTEI_URL** / **NIGHTMARE_CLUB_YOTEI_READ_URL**.',
    waves_yotei_read_401:
      'Nightmare.Club **401** on Yōtei: check **NIGHTMARE_CLUB_YOTEI_TOKEN** (must match `BOT_API_TOKEN_YOTEI` on the site).',
    waves_yotei_read_http: 'Failed to load Yōtei rotation: HTTP **{status}**.',
    waves_yotei_read_timeout: 'Yōtei API request timed out. Try again later.',
    waves_yotei_read_network: 'Network error while loading Yōtei rotation. Try again later.',
    waves_wrong_channel: 'Use `/waves` in a server text channel or in DMs with the bot.',
  },
  ru: {
    choose_language_line: 'Choose your language / Выбери свой язык',
    btn_english: 'English',
    btn_russian: 'Русский',
    choose_week: 'Выберите неделю:',
    choose_wave: 'Выберите волну (ячейку):',
    choose_zone: 'Выберите зону:',
    choose_spawn: 'Выберите спавн:',
    btn_done: 'Готово',
    forbidden: 'У вас нет доступа к этой команде.',
    dm_only:
      'Эта команда работает только в личных сообщениях. Откройте ЛС с ботом и выполните её там.',
    game_not_available: 'Эта игра пока недоступна в редакторе.',
    saved_success: 'Сохранено в базу бота (SQLite).',
    saved_success_api: 'Опубликовано в Nightmare.Club.',
    api_not_configured:
      'API Nightmare.Club не настроено. Задайте **NIGHTMARE_CLUB_TSUSHIMA_URL** и **NIGHTMARE_CLUB_TSUSHIMA_TOKEN** в `.env` (тот же токен, что `BOT_API_TOKEN_TSUSHIMA` на сайте).',
    api_payload_error: 'Внутренняя ошибка сборки запроса к API. См. логи.',
    api_network_error: 'Сетевая ошибка при обращении к Nightmare.Club. Попробуйте позже.',
    api_publish_failed_prefix: 'Nightmare.Club отклонил публикацию:',
    api_week_line: 'Неделя на сайте (week_start): **{week}**',
    grid_incomplete: 'Сетка волн заполнена не полностью.',
    setup_reset: 'Начинаем заново. Используйте кнопки ниже.',
    edit_panel_reopened: 'Редактирование: панель обновлена ниже.',
    week_prefix: 'Карта:',
    all_filled_hint: 'Все ячейки заполнены. Нажмите **Готово**, чтобы сохранить.',
    confirm_saved: 'Можно снова вызвать `/setup-waves` или `/edit-waves`.',
    session_stale: 'Сессия сброшена или устарела. Запустите `/setup-waves` или `/edit-waves`.',
    session_expired_idle:
      'Сессия истекла (час без активности). Запустите `/setup-waves` или `/edit-waves`, чтобы открыть новую панель.',
    wizard_message_deleted:
      'Сообщение мастера удалено или недоступно. Запустите `/setup-waves` или `/edit-waves`, чтобы открыть новую панель.',
    grid_page: 'Страница {cur}/{tot}',
    btn_prev: 'Назад',
    btn_next: 'Далее',
    week_code_label: 'Неделя {code}',
    mods_prefix: 'Модификаторы:',
    wave_spawn_header: 'Волна {wave} - Спавн {wave}.{slot}',
    zone_line_prefix: 'Зона:',
    btn_wizard_back: 'Назад',
    edit_tsushima_missing:
      'Нет ротации Tsushima на текущую неделю на сайте (пустой `maps` в API). Сначала опубликуйте через `/setup-waves` или проверьте сайт.',
    edit_tsushima_invalid:
      'Не удалось собрать черновик из ответа Nightmare.Club (некорректный или неожиданный JSON).',
    edit_tsushima_week_unknown:
      'Код недели с сайта не найден в `json/rotation_tsushima_*.json`. Обновите файлы ротации в боте и перезапустите.',
    edit_tsushima_multi_map_note:
      'В ответе API несколько карт на эту неделю; открыта **первая** запись.',
    week_not_in_rotation:
      'Эта **неделя** не найдена в текущем rotation JSON. Запустите `/setup-waves`, чтобы выбрать актуальную неделю, или исправьте данные в базе.',
    week_select_failed: 'Этой недели больше нет в ротации. Выберите другую ниже.',
    invalid_wave_slot: 'Некорректная ячейка волны.',
    bulk_intro: '',
    bulk_spawn_names_header: 'Используйте только такие названия (зона и спавн, либо только зона, если спавн один):',
    bulk_format_header: 'Формат (одна строка на волну, три ячейки через запятую):',
    bulk_format_and_so_on: 'и так далее',
    bulk_reply_hint: 'Пришлите список **ответом** на это сообщение.',
    bulk_cancel: 'Отмена',
    bulk_err_bad_line: 'Строка не похожа на `N. ячейка, ячейка, ячейка`:',
    bulk_err_bad_wave_num: 'Неверный номер волны (нужны 1–15).',
    bulk_err_dup_wave: 'Повтор номера волны:',
    bulk_err_bad_slot_count: 'Волна {wave}: нужно ровно три ячейки через запятую.',
    bulk_err_missing_waves: 'Нужно 15 строк с номерами волн 1–15, в каждой три ячейки.',
    bulk_err_bad_slots: 'Неизвестные подписи (**жирным**). Исправьте и пришлите список снова:',
    bulk_err_unknown: 'Не удалось разобрать список.',
    credits_modal_title: 'Благодарности (Credits)',
    credits_modal_label: 'Текст благодарностей / атрибуция',
    credits_modal_placeholder: 'Необязательно — пусто будет подставлен стандартный текст.',
    waves_read_401:
      'Nightmare.Club вернул **401**: проверьте **NIGHTMARE_CLUB_TSUSHIMA_TOKEN** в `.env` (должен совпадать с `BOT_API_TOKEN_TSUSHIMA` на сайте).',
    waves_read_http: 'Не удалось загрузить ротацию Tsushima: HTTP **{status}**.',
    waves_read_timeout: 'Превышено время ожидания API Nightmare.Club. Попробуйте позже.',
    waves_read_network: 'Сетевая ошибка при загрузке ротации Tsushima. Попробуйте позже.',
    waves_yotei_api_not_configured:
      'Не задан токен для чтения Yōtei. Укажите **NIGHTMARE_CLUB_YOTEI_TOKEN** в `.env` (тот же секрет, что **`BOT_API_TOKEN_YOTEI`** на Nightmare.Club). При необходимости: **NIGHTMARE_CLUB_YOTEI_URL** / **NIGHTMARE_CLUB_YOTEI_READ_URL**.',
    waves_yotei_read_401:
      'Nightmare.Club вернул **401** для Yōtei: проверьте **NIGHTMARE_CLUB_YOTEI_TOKEN** (должен совпадать с `BOT_API_TOKEN_YOTEI` на сайте).',
    waves_yotei_read_http: 'Не удалось загрузить ротацию Yōtei: HTTP **{status}**.',
    waves_yotei_read_timeout: 'Превышено время ожидания API Yōtei. Попробуйте позже.',
    waves_yotei_read_network: 'Сетевая ошибка при загрузке ротации Yōtei. Попробуйте позже.',
    waves_wrong_channel: 'Вызывайте `/waves` в текстовом канале сервера или в ЛС с ботом.',
  },
};

/** @param {'en' | 'ru'} locale @param {string} key */
export function t(locale, key) {
  const pack = strings[locale] ?? strings.en;
  return pack[key] ?? strings.en[key] ?? key;
}
