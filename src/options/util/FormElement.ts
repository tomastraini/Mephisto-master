import { byId, query } from '../../shared/dom';

export type FormElementType = 'input' | 'checkbox' | 'select';

/** Anything a setting can hold. `valueType` records which one the default was. */
export type FormValue = string | number | boolean;

/**
 * One control on a settings page, addressed by the convention that its element
 * id is `${name}_${type}`.
 */
export class FormElement {
    readonly name: string;
    readonly desc: string;
    readonly type: FormElementType;
    readonly default: FormValue;
    readonly valueType: string;
    private readonly elem: HTMLInputElement | HTMLSelectElement;

    constructor(name: string, description: string, type: FormElementType, defaultValue: FormValue) {
        this.name = name;
        this.desc = description;
        this.type = type;
        this.default = defaultValue;
        this.valueType = typeof defaultValue;
        this.elem = byId<HTMLInputElement | HTMLSelectElement>(`${name}_${type}`);
    }

    registerChangeListener(fn: () => void): void {
        // `input` fires per keystroke; the other two only settle on commit.
        this.elem.addEventListener(this.type === 'input' ? 'input' : 'change', fn);
    }

    getValue(): FormValue {
        if (this.type === 'checkbox') {
            return (this.elem as HTMLInputElement).checked;
        }
        return this.elem.value;
    }

    setValue(value: FormValue): void {
        if (this.type === 'checkbox') {
            (this.elem as HTMLInputElement).checked = Boolean(value);
            return;
        }

        this.elem.value = String(value);

        if (this.type === 'select') {
            // Materialize renders a <select> as a read-only text input backed by
            // the real element, so the visible text has to be set separately.
            this.syncMaterializeSelectLabel(String(value));
        }
    }

    private syncMaterializeSelectLabel(value: string): void {
        const label = this.elem.parentElement
            ? query<HTMLInputElement>('input', this.elem.parentElement)
            : null;
        const option = query<HTMLOptionElement>(`option[value="${value}"]`, this.elem);
        if (label && option) {
            label.value = option.innerText;
        }
    }
}
