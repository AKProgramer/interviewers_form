# Interviewer review form (monday.com → Vercel)

Open: `https://<your-project>.vercel.app/?itemId=<Main Volunteers Board item id>`

## Deploy
1. Push this folder to a GitHub repo and import it in Vercel (Framework preset: **Other**), or run `npx vercel` inside the folder.
2. In Vercel → Project → Settings → Environment Variables add:
   - `MONDAY_API_TOKEN` – monday.com: avatar → Developers → My access tokens
   - `WEBHOOK_URL` – where submissions are POSTed
   - `MAIN_BOARD_ID` – optional, defaults to 5101747214
3. Redeploy after adding the variables.

## Webhook payload (POST, JSON)
- `item` – id, name, boardId
- `values` – interviewerNotes (with a "Rejection reasons:" block appended when rejected), rejected ("Yes"/"No"),
  rejectionReasons [string], status, recommendationStatus, garin,
  meetingSummaryNewFiles [{name, mimeType, size, base64}] (at most one file: the summary uploaded in this submission)
- `columns` – keyed by column id, each with title, value, previous, changed
- `mondayColumnValues` – JSON string ready for change_multiple_column_values (text + status columns)

The uploaded file is sent as base64 and capped at 3 MB (Vercel body limit).
