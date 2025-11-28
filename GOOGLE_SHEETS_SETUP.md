# Google Sheets Setup Guide

## Step 1: Share Your Google Sheet with Service Account

1. Open your Google Sheet
2. Click the **"Share"** button (top right)
3. In the "Add people and groups" field, paste:
   ```
   othello-sheet-bot@othellocodingapp.iam.gserviceaccount.com
   ```
4. Set permission to **"Editor"**
5. **Uncheck** "Notify people" (service accounts don't need email notifications)
6. Click **"Share"**

## Step 2: Get Your Spreadsheet ID

1. Open your Google Sheet
2. Look at the URL in your browser:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID_HERE/edit
   ```
3. Copy the long string between `/d/` and `/edit`
    - Example: If URL is `https://docs.google.com/spreadsheets/d/1a2b3c4d5e6f7g8h9i0j/edit`
    - Your Spreadsheet ID is: `1a2b3c4d5e6f7g8h9i0j`

## Step 3: Update application.properties

1. Open `othello/src/main/resources/application.properties`
2. Replace `YOUR_SPREADSHEET_ID_HERE` with your actual Spreadsheet ID:
   ```properties
   google.sheets.spreadsheet.id=YOUR_ACTUAL_SPREADSHEET_ID
   ```

## Step 4: Create Your Sheets

Your Google Sheet should have **two tabs**:

### Tab 1: "Questions"
- **Column A**: Question (coding problem description)
- **Column B**: Test Cases (formatted text)

Example:
| Question | Test Cases |
|----------|------------|
| Write a C program to reverse a string | Test Case 1:\nInput: hello\nExpected Output: olleh\n\nTest Case 2:\nInput: world\nExpected Output: dlrow |

### Tab 2: "Logs" (Auto-created)
- This sheet will be automatically created with headers:
    - Player Name | Move Column | Move Row | Question Asked | Submitted Code | Timestamp

## Verification Checklist

- [ ] Google Sheet is shared with: `othello-sheet-bot@othellocodingapp.iam.gserviceaccount.com` (Editor access)
- [ ] Spreadsheet ID is added to `application.properties`
- [ ] "Questions" tab exists with at least one question
- [ ] Credentials JSON file is at: `src/main/resources/credentials.json`

## Troubleshooting

**Error: "Google Sheets Spreadsheet ID not configured!"**
- Make sure you've added the Spreadsheet ID to `application.properties`

**Error: "403 Forbidden" or "Permission denied"**
- Verify the sheet is shared with the service account email
- Make sure permission is set to "Editor" (not "Viewer")

**Error: "Sheet 'Questions' not found"**
- Make sure you have a tab named exactly "Questions" (case-sensitive)
- Check that the sheet name matches `google.sheets.questions.sheet.name` in `application.properties`

