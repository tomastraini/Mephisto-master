import { type ConfigKey, DEFAULT_CONFIG } from '../../shared/config';
import { byId } from '../../shared/dom';
import { FormElement, type FormElementType, type FormValue } from './FormElement';

/**
 * Base for a settings page: owns a set of form controls and moves their values
 * to and from localStorage.
 *
 * Subclasses implement `init()` to register their controls. `onInit()` is the
 * entry point the options shell calls once the page markup is in the DOM.
 */
export abstract class SettingsPage {
    private applyButton: HTMLButtonElement | undefined;
    private resetButton: HTMLButtonElement | undefined;
    private readonly formElements: FormElement[] = [];
    /** Snapshot of the last-saved values, used to enable/disable Apply. */
    private savedSnapshot = '';

    /** Register this page's form elements. */
    protected abstract init(): void;

    onInit(): void {
        this.applyButton = byId<HTMLButtonElement>('apply_btn');
        this.applyButton.addEventListener('click', () => this.onApplyConfigValues());
        this.resetButton = byId<HTMLButtonElement>('reset_btn');
        this.resetButton.addEventListener('click', () => this.onResetConfigValues());

        this.init();

        this.pullConfigValues();
        this.onConfigValuesChanged();
    }

    /**
     * `name` is a config key, so a typo is a compile error, and the default
     * comes from DEFAULT_CONFIG rather than being written down a second time
     * here -- which is how the two copies drifted apart.
     */
    protected registerFormElement(name: ConfigKey, description: string, type: FormElementType): void {
        const formElement = new FormElement(name, description, type, DEFAULT_CONFIG[name]);
        formElement.registerChangeListener(() => this.onConfigValuesChanged());
        this.formElements.push(formElement);
    }

    // -- localStorage push/pull ---------------------------------------------

    private pullConfigValues(): void {
        for (const formElement of this.formElements) {
            const stored = localStorage.getItem(formElement.name);
            // An empty string is treated as "unset": a cleared number input
            // stores "" and JSON.parse would throw on it.
            formElement.setValue(stored ? (JSON.parse(stored) as FormValue) : formElement.default);
        }
        this.updateSnapshot();
    }

    private pushConfigValues(): void {
        for (const formElement of this.formElements) {
            // Values are stored as JSON, so strings need their quotes back.
            const value =
                formElement.valueType === 'string'
                    ? `"${String(formElement.getValue())}"`
                    : String(formElement.getValue());
            localStorage.setItem(formElement.name, value);
        }
        this.updateSnapshot();
    }

    private clearConfigValues(): void {
        for (const formElement of this.formElements) {
            localStorage.removeItem(formElement.name);
        }
        this.updateSnapshot();
    }

    // -- dirty tracking -----------------------------------------------------

    private createSnapshot(): string {
        return this.formElements
            .map((formElement) => `${formElement.name}:${String(formElement.getValue())}`)
            .join(' ');
    }

    private updateSnapshot(): void {
        this.savedSnapshot = this.createSnapshot();
    }

    // -- event handlers -----------------------------------------------------

    private onApplyConfigValues(): void {
        this.pushConfigValues();
        this.onConfigValuesChanged();
    }

    private onResetConfigValues(): void {
        this.clearConfigValues();
        this.pullConfigValues();
        this.onConfigValuesChanged();
    }

    private onConfigValuesChanged(): void {
        if (this.applyButton) {
            this.applyButton.disabled = this.savedSnapshot === this.createSnapshot();
        }
    }
}
