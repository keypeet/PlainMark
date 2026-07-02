// เมนู Slash Command (/) ใน editor — ใช้ระบบ autocomplete ของ CodeMirror
// รายการคำสั่ง + fuzzy filter อยู่ใน lib/slashCommands.ts
import {
  autocompletion,
  Completion,
  CompletionContext,
  CompletionResult
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { filterSlashCommands, SlashCommand } from '../../lib/slashCommands';

function toCompletion(command: SlashCommand): Completion {
  return {
    label: command.label,
    detail: command.detail,
    type: 'keyword',
    apply: (view, _completion, from, to) => {
      // ลบ "/query" ทิ้งแล้วแทรก Markdown ของคำสั่ง (from ชี้ที่ตัว "/")
      const cursor = from + (command.cursorOffset ?? command.insert.length);
      view.dispatch({
        changes: { from, to, insert: command.insert },
        selection: { anchor: cursor },
        scrollIntoView: true,
        userEvent: 'input.complete'
      });
    }
  };
}

function slashSource(context: CompletionContext): CompletionResult | null {
  // จับ "/คำค้น" ที่อยู่ต้นบรรทัดหรือหลังช่องว่าง (กันชนกับ URL อย่าง https://)
  const match = context.matchBefore(/(?:^|\s)\/[\w฀-๿]*$/);
  if (!match) return null;
  const slashIndex = match.text.indexOf('/');
  const from = match.from + slashIndex;
  const query = match.text.slice(slashIndex + 1);

  const commands = filterSlashCommands(query);
  if (!commands.length) return null;

  return {
    from,
    options: commands.map(toCompletion),
    // ให้เมนูอัปเดตเองขณะพิมพ์ต่อ — เรากรองเองด้วย fuzzyMatch แล้ว
    filter: false
  };
}

export function slashMenu(): Extension {
  return autocompletion({
    override: [slashSource],
    activateOnTyping: true,
    icons: false,
    defaultKeymap: true
  });
}
