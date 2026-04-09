/** Отступ для 2-й и далее ячеек волны (под первой строкой с номером). */
export const WAVE_SLOT_INDENT = '    ';
/** Разделитель между волнами в описании эмбеда. */
export const WAVE_BLOCK_SEPARATOR = `\n${'\u2500'.repeat(16)}\n`;

/** Лимит текста сообщения Discord (content). */
export const MESSAGE_CONTENT_MAX = 2000;

const WIDE_WAVE_CONT_EXTRA = '   ';

export function waveContinuationExtraIndent(waveNum) {
  if (waveNum < 10) return '';
  if (waveNum === 11) return WIDE_WAVE_CONT_EXTRA.slice(1);
  return WIDE_WAVE_CONT_EXTRA;
}

/** +1 пробел к отступу продолжений: однозначные 2–6 и 8–9 (не 1 и не 7). */
export function singleDigitWaveContinuationPad(waveNum) {
  if (waveNum < 2 || waveNum > 9) return '';
  if (waveNum === 7) return '';
  return ' ';
}

/** Номер волны в Discord markdown (жирный): `**1.**` */
export function boldWavePrefix(waveNum) {
  return `**${waveNum}.**`;
}

/**
 * Один блок волны: первая ячейка с номером, остальные с отступом на новых строках.
 *
 * @param {number} displayWaveNum отображаемый номер (1-based внутри эмбеда)
 * @param {string[]} cellLines уже отформатированные строки ячеек (по порядку)
 * @param {string} emptyLineLabel подпись при отсутствии ячеек
 */
export function formatWaveBlockFromCellLines(displayWaveNum, cellLines, emptyLineLabel) {
  if (!cellLines.length) {
    return `${boldWavePrefix(displayWaveNum)} ${emptyLineLabel}`;
  }
  const contExtra = `${singleDigitWaveContinuationPad(displayWaveNum)}${waveContinuationExtraIndent(displayWaveNum)}`;
  const first = `${boldWavePrefix(displayWaveNum)} ${cellLines[0]}`;
  const rest = cellLines
    .slice(1)
    .map((p) => `${WAVE_SLOT_INDENT}${contExtra}${p}`)
    .join('\n');
  return rest ? `${first}\n${rest}` : first;
}

/**
 * Обрезка content до 2000; при непустом credit — блок `*credit*` после двойного перевода строки.
 *
 * @param {string} body основной текст (без credits)
 * @param {string} [creditText]
 */
export function finalizeDiscordMessageContent(body, creditText) {
  const credit = String(creditText ?? '').trim();
  if (!credit) {
    return body.length > MESSAGE_CONTENT_MAX
      ? `${body.slice(0, MESSAGE_CONTENT_MAX - 1)}…`
      : body;
  }

  let creditLine = `*${credit}*`;
  if (creditLine.length > MESSAGE_CONTENT_MAX) {
    const innerMax = MESSAGE_CONTENT_MAX - 3;
    creditLine = `*${credit.slice(0, Math.max(0, innerMax - 1))}…*`;
  }
  const sepLen = 2;
  const maxBody = MESSAGE_CONTENT_MAX - sepLen - creditLine.length;
  if (maxBody < 0) {
    return creditLine.slice(0, MESSAGE_CONTENT_MAX);
  }
  const trimmedBody =
    body.length > maxBody ? `${body.slice(0, Math.max(0, maxBody - 1))}…` : body;
  return `${trimmedBody}\n\n${creditLine}`;
}
