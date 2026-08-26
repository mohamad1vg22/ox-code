export type Intent =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'testing'
  | 'explain'
  | 'review'
  | 'debug'
  | 'question'

const PATTERNS: Array<[Intent, RegExp]> = [
  ['bugfix', /\b(fix|bug|broken|error|fails?|failing|crash|wrong|درست\s*کن|باگ|خطا|خراب|کار\s*نمی)\b/i],
  ['debug', /\b(why.*(not|doesn'?t|isn'?t)|چرا|نمی.?فهمم|مشکل\s*کجاست|debug)\b/i],
  ['refactor', /\b(refactor|clean|tidy|reorganize|simplify|rename|تمیز|بازسازی|مرتب)\b/i],
  ['testing', /\b(test|spec|coverage|تست|تست\s*بنویس)\b/i],
  ['review', /\b(review|audit|check\s*(my|the)?\s*code|بررسی|ریویو)\b/i],
  ['explain', /\b(explain|what\s*(is|does)|how\s*does|توضیح|چیه|چگونه|چطور)\b/i],
  ['feature', /\b(add|create|implement|build|make|feature|support|اضافه|بساز|ایجاد|پیاده)\b/i]
]

export interface DetectedIntent {
  intent: Intent
  keywords: string[]
}

/** Fast, deterministic, offline intent detection used to steer context building. */
export function detectIntent(request: string): DetectedIntent {
  for (const [intent, re] of PATTERNS) {
    if (re.test(request)) return { intent, keywords: extractKeywords(request) }
  }
  return { intent: 'question', keywords: extractKeywords(request) }
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'in', 'of', 'for', 'and', 'or', 'on', 'with', 'this', 'that',
  'is', 'are', 'was', 'be', 'please', 'can', 'you', 'it', 'code', 'file',
  'رو', 'تو', 'را', 'که', 'این', 'آن', 'با', 'از', 'به', 'کن', 'کنبده', 'یک', 'برای', 'و', 'در'
])

function extractKeywords(request: string): string[] {
  return request
    .split(/[^\w\u0600-\u06FF._-]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 12)
}
