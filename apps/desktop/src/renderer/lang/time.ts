// Strings for the timer and the Time view. Keys are "timer.*" and "time.*"; add both languages together.
export const en = {
  "timer.start": "Start timer",
  "timer.stop": "Stop timer",
  "timer.untitled": "Untitled",
  "timer.palette": "Start a timer on…",
  "timer.paletteHint": "Type what you're working on, or pick an issue or a project.",
  "timer.startFree": "Start “{text}”",
  "timer.startBlank": "Start a timer",
} as Record<string, string>;

export const ar: Record<keyof typeof en, string> = {
  "timer.start": "ابدأ المؤقّت",
  "timer.stop": "أوقف المؤقّت",
  "timer.untitled": "بلا عنوان",
  "timer.palette": "ابدأ مؤقّتًا على…",
  "timer.paletteHint": "اكتب ما تعمل عليه، أو اختر مهمة أو مشروعًا.",
  "timer.startFree": "ابدأ «{text}»",
  "timer.startBlank": "ابدأ مؤقّتًا",
};
