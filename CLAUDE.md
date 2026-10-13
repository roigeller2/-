# הוראות עבודה לפרויקט הזה

## שפה
- כל תקשורת עם המשתמש בפרויקט הזה תהיה בעברית, אלא אם התבקש במפורש לעבור לאנגלית.

## פורמט תשובות
- **כל** תשובה (ניתוח, הסבר, המלצה, עדכון סטטוס, גם הודעות קצרות) תינתן **כולה** בתוך בלוק טקסט אחד (code block) מתחילתה ועד סופה — בלי שום טקסט מחוץ לבלוק (לא לפני ולא אחרי). קטעי קוד בתוך התשובה נשארים משולבים בפנים, לא בבלוקים נפרדים משלהם. המטרה: שהמשתמש יוכל להעתיק את כל התשובה בלחיצה אחת, כדי להדביק אותה בצ'אט עם כלי AI אחר.

## תהליך Git
- אחרי כל שינוי שהמשתמש מאשר:
  - לבצע Commit עם הודעה מתאימה.
  - לבצע Push ישירות ל-`main`.
  - לא ליצור Branch חדש.
  - לא ליצור Pull Request אלא אם התבקש במפורש.
- אחרי Push, לעדכן את המשתמש שהפריסה ל-Vercel התחילה.
- אם יש קונפליקט מיזוג או שגיאת Push — לעצור ולעדכן את המשתמש לפני שממשיכים.

## נוהל קבוע לפני כל Commit + Push ל-main (מ-2026-07-10, עודכן בהמשך אותו יום)

הערה טכנית חשובה: לסביבת העבודה שלי (Claude Code) אין גישת רשת לאתר בפרודקשן
(`https://coordination-app-gamma.vercel.app`) — הפרוקסי הארגוני חוסם את זה
במפורש (403). לכן לא ניתן לי למשוך את נתוני הפרודקשן ישירות דרך ה-API, וגיבוי
הנתונים האמיתי חייב להתבצע ידנית דרך המשתמש, כמפורט למטה.

**לפני שינוי משמעותי** שעלול להשפיע על הקוד, ה-API, מסד הנתונים, מבנה הנתונים
או הלוגיקה המרכזית (לא נדרש לשינויי תיעוד/טקסט בלבד או שינויים בלי השפעה
אפשרית על הנתונים):

1. לעצור **לפני** Commit ו-Push.
2. לבקש מהמשתמש להיכנס באתר למסך "נתונים וסטטיסטיקות".
3. לבקש מהמשתמש ללחוץ על כפתור "גיבוי מלא (JSON)".
4. לבקש מהמשתמש לשמור את הקובץ שהורד ב-Google Drive, בתיקייה:
   `Coordination App / Backups`
5. שם הקובץ צריך לכלול תאריך ושעה בפורמט: `backup-YYYY-MM-DD-HH-MM-SS.json`.
6. להמתין לאישור מהמשתמש שהגיבוי נשמר בהצלחה ב-Google Drive.
7. **רק לאחר מכן** להמשיך: להריץ בדיקת Build (`npm run build`) ולוודא שהיא
   עוברת ללא שגיאות, לבצע Commit עם הודעה ברורה, ולבצע Push ישירות ל-`main`.
8. לוודא שהפריסה ל-Vercel התחילה, ולדווח למשתמש: מספר הקומיט ואישור שהפריסה
   התחילה.
9. **לא** לשמור קבצי גיבוי בתוך הריפו של GitHub ולא להוסיף אותם ל-Repository
   — הגיבויים הולכים ל-Google Drive בלבד, לא ל-git.

נוסף:
- אם השינוי עלול להשפיע על נתונים / מבנה מסד הנתונים / ה-API / הלוגיקה המרכזית — להריץ בדיקות בסיסיות אחרי השינוי כדי לוודא שלא נשברו פונקציות קיימות. אם מזוהה סיכון לאובדן נתונים — לעצור ולהסביר את הסיכון למשתמש לפני Push.
- אם יש Merge Conflict / שגיאת Build / שגיאת Push / כל תקלה אחרת — לא לבצע Push, לעצור ולעדכן את המשתמש עם הסבר ברור ודרך פעולה מומלצת.
- לא לבצע מחיקות, איפוסי נתונים, שינויי ארכיטקטורה גדולים, או שינויי מסד נתונים — ללא אישור מפורש מהמשתמש.

## כללי יעילות (Efficiency rules)
- Be brief and direct; expand when needed or asked. Don't repeat requests, context, agreed plans or explanations.
- Act immediately on simple tasks; give a short plan for complex ones. Complete authorized work without extra approvals for minor details.
- Search/read narrowly, then widen as needed. Read enough to understand dependencies. Re-read when content changed, the prior read was partial, or the task requires it.
- Keep tool output focused; expand when needed for diagnosis.
- Keep changes scoped; avoid unrequested refactors and additions.
- Run checks appropriate to change and risk; repeat only for a new reason.
- Diagnose before retrying. Retry justified transient failures; change approach when repeated failures produce no progress.
- Use subagents only when the benefit justifies the overhead.
- Keep brief progress notes for long tasks. Finish with changes, verification and remaining actions.
- Never save effort by guessing, skipping necessary verification or leaving work unfinished.
- When irrelevant context accumulates or the task changes, suggest compaction or a new session as appropriate. At a safe transition, preserve one copyable handoff block: goal, requirements, decisions, completed work, checks, relevant files/commits and next step. Exclude sensitive information and unnecessary history. Don't interrupt active operations or lose work; don't claim unavailable capabilities or exact token savings without evidence.
- When I write "אחד תשובה", merge your last two responses into one complete answer, remove duplication and prefer the latest correction when they conflict.
- Project-specific language, formatting, backup and approval requirements take precedence over these efficiency defaults.
