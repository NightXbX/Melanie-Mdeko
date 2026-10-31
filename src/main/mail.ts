import { execFile } from 'node:child_process'
import type { DatabaseSync } from 'node:sqlite'
import { shell } from 'electron'
import { mailAddresses as addresses, type MailRequest } from '@shared/projects'
import { saveBookInProject } from './book/export'
import type { DataPaths } from './paths'

// Message préparé dans Mail d'Apple (la boîte de Mélanie) : destinataires, objet, texte et pièces jointes.
// C'est elle qui relit et clique sur « Envoyer ». Pour une pièce jointe lourde, Mail propose Mail Drop
// (lien iCloud valable 30 jours) : rien à faire de notre côté.
const SCRIPT = `
on run argv
  set theSubject to item 1 of argv
  set theBody to item 2 of argv
  set AppleScript's text item delimiters to ","
  set theAddresses to text items of (item 3 of argv)
  set AppleScript's text item delimiters to ""
  tell application "Mail"
    set theMessage to make new outgoing message with properties {subject:theSubject, content:theBody & return & return, visible:true}
    tell theMessage
      repeat with theAddress in theAddresses
        if (theAddress as text) is not "" then make new to recipient at end of to recipients with properties {address:(theAddress as text)}
      end repeat
    end tell
    delay 0.5
    repeat with i from 4 to count of argv
      tell content of theMessage to make new attachment with properties {file name:(POSIX file (item i of argv) as alias)} at after last paragraph
    end repeat
    activate
  end tell
end run`

function runAppleScript(args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile('osascript', ['-e', SCRIPT, ...args], { timeout: 60000 }, (error, _out, stderr) => {
      if (!error) return resolve()
      // -1743 : macOS n'a pas (encore) autorisé Mdeko à piloter Mail.
      if (/-1743|not authori[sz]ed/i.test(stderr)) {
        reject(new Error('Mdeko n’a pas l’autorisation d’utiliser Mail. Autorisez-la dans Réglages Système › Confidentialité et sécurité › Automatisation, puis réessayez.'))
      } else {
        reject(new Error('Mail n’a pas pu préparer le message. Vérifiez que Mail est configuré avec votre adresse.'))
      }
    })
  )
}

export async function prepareMail(db: DatabaseSync, paths: DataPaths, projectId: number, mail: MailRequest): Promise<{ files: string[]; inMail: boolean }> {
  const files: string[] = []
  for (const format of mail.formats) files.push(await saveBookInProject(db, paths, projectId, format))

  let inMail = false
  if (process.platform === 'darwin') {
    await runAppleScript([mail.subject, mail.body, addresses(mail.to), ...files])
    inMail = true
  } else {
    // Ailleurs que sur Mac (essais du développeur) : le mail s'ouvre sans pièce jointe, et le fichier est montré.
    const query = `subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`
    await shell.openExternal(`mailto:${addresses(mail.to)}?${query}`)
    if (files[0]) shell.showItemInFolder(files[0])
  }
  db.prepare('UPDATE projects SET mailed_at = ? WHERE id = ?').run(new Date().toISOString(), projectId)
  return { files, inMail }
}
