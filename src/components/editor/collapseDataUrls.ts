// พับ data URL ของรูป base64 ให้เห็นเป็นชิปสั้นๆ แทนตัวอักษรยาวหลายหมื่นตัว (ข้อมูลจริงในไฟล์ยังครบ)
import {
  Decoration,
  DecorationSet,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  ViewUpdate,
  WidgetType
} from '@codemirror/view';

class DataUrlChip extends WidgetType {
  constructor(
    private readonly mime: string,
    private readonly sizeLabel: string
  ) {
    super();
  }

  eq(other: DataUrlChip): boolean {
    return other.mime === this.mime && other.sizeLabel === this.sizeLabel;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'cm-image-chip';
    chip.textContent = `🖼 ${this.mime} · ${this.sizeLabel}`;
    chip.title = 'รูปภาพ base64 (ถูกย่อการแสดงผล — ข้อมูลจริงยังอยู่ในไฟล์)';
    return chip;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const dataUrlDecorator = new MatchDecorator({
  regexp: /data:(image\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]{40,}/gi,
  decoration: (match) => {
    const bytes = Math.round((match[0].length - match[0].indexOf(',') - 1) * 0.75);
    const sizeLabel = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return Decoration.replace({ widget: new DataUrlChip(match[1], sizeLabel) });
  }
});

export const collapseDataUrls = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = dataUrlDecorator.createDeco(view);
    }

    update(update: ViewUpdate) {
      this.decorations = dataUrlDecorator.updateDeco(update, this.decorations);
    }
  },
  {
    decorations: (value) => value.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none)
  }
);
