# Tiny Notes: product spec (example)

This is the written spec the S2 researchers read. It is the source of truth when it disagrees with the code.

## 1. Notes
1.1 A signed-in user adds a note with a title of 1 to 80 characters (after trimming spaces). The new note appears at the top of the list.
1.2 An empty title, or a title longer than 80 characters, is rejected with the message "Title must be 1-80 characters". Nothing is saved.
1.3 Above the list the page shows how many notes the user has: "1 note", "2 notes", "0 notes".
1.4 A user deletes one of their own notes with the "Delete" button next to it. The count goes down by one.
1.5 A user only ever sees their own notes.

## 2. Access
2.1 A visitor who is not signed in gets HTTP 401 from every notes endpoint, and the page shows the sign-in form.
2.2 Wrong user or password: HTTP 401 and the message "Invalid credentials".
2.3 A user cannot delete another user's note. The API answers 404 exactly as for a note that does not exist.
2.4 `/api/admin/stats` is for admins only: a member gets 403, a visitor 401.

## 3. Look
3.1 Header "Tiny Notes", 24 px, bold, white on the brand blue `#0b5cad`.
3.2 Every button is at least 44 x 44 px (touch target).
3.3 Body text contrast is at least 4.5:1.
