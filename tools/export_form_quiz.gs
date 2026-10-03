// Run in script.google.com using the Google account that owns your quiz form.
// Set the form URL and quiz date. This exports the original choices and answer key.
function exportPreshiftQuiz() {
  const formUrl = 'PASTE_YOUR_GOOGLE_FORM_EDIT_URL_HERE';
  const quizDate = '2026-10-03';
  const form = FormApp.openByUrl(formUrl);
  const questions = [];
  const skipped = [];
  form.getItems().forEach(item => {
    if (item.getType() !== FormApp.ItemType.MULTIPLE_CHOICE) {
      if ([FormApp.ItemType.PAGE_BREAK, FormApp.ItemType.SECTION_HEADER, FormApp.ItemType.IMAGE, FormApp.ItemType.VIDEO].indexOf(item.getType()) < 0) skipped.push(item.getTitle());
      return;
    }
    const q = item.asMultipleChoiceItem();
    const choices = q.getChoices();
    const correct = choices.findIndex(c => c.isCorrectAnswer());
    if (correct < 0 || choices.length < 2 || choices.length > 6) {
      skipped.push(q.getTitle());
      return;
    }
    questions.push({prompt:q.getTitle(), category:'Pre-Shift', options:choices.map(c=>c.getValue()), correct:correct, explanation:q.getFeedbackForCorrect()?.getText() || ''});
  });
  if (!questions.length) throw new Error('No supported questions with answer keys were found.');
  if (questions.length > 50) throw new Error('Split this quiz into sets of 50 questions or fewer.');
  const json = JSON.stringify({quiz_date:quizDate,title:form.getTitle(),questions:questions}, null, 2);
  const file = DriveApp.createFile('preshift-' + quizDate + '.json', json, MimeType.PLAIN_TEXT);
  console.log('Download this JSON and import it in the app’s Question Bank: ' + file.getUrl());
  if (skipped.length) console.log('Review these skipped items manually: ' + skipped.join('; '));
}
