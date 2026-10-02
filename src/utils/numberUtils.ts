/**
 * Number & Digit Utilities
 * 
 * Ensures all numbers, phone numbers, ages, and counters on Nikhoj Alert
 * are rendered with maximum clarity and zero ambiguity.
 * Standardizes Bengali numerals (০-৯) to crisp, legible standard digits (0-9).
 */

const BENGALI_TO_STANDARD: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

const STANDARD_TO_BENGALI: Record<string, string> = {
  '0': '০',
  '1': '১',
  '2': '২',
  '3': '৩',
  '4': '৪',
  '5': '৫',
  '6': '৬',
  '7': '৭',
  '8': '৮',
  '9': '৯',
};

/**
 * Converts Bengali digits to standard legible digits (0-9)
 * Solves the issue where Bengali '১' is confused with '9' or hard to read.
 */
export function toCleanDigits(input: string | number | undefined | null): string {
  if (input === undefined || input === null) return '';
  const str = String(input);
  return str.replace(/[০-৯]/g, (char) => BENGALI_TO_STANDARD[char] || char);
}

/**
 * Formats a phone number for clear reading and dialing in Bangladesh
 */
export function formatPhoneNumber(phone: string | undefined | null): string {
  if (!phone) return '';
  const clean = toCleanDigits(phone).replace(/[^\d+]/g, '');
  if (clean.length === 11 && clean.startsWith('01')) {
    return `${clean.slice(0, 5)}-${clean.slice(5)}`;
  }
  return toCleanDigits(phone);
}

/**
 * Formats an age string for clear reading (e.g., "7 বছর", "68 বছর")
 */
export function formatAge(age: string | number | undefined | null): string {
  if (!age) return '';
  const clean = toCleanDigits(String(age));
  if (clean.includes('বছর') || clean.includes('মাস')) {
    return clean;
  }
  return `${clean} বছর`;
}
