import { queryAll } from '../../../../shared/dom';
import { SettingsPage } from '../../../util/SettingsPage';

class AppearanceSettings extends SettingsPage {
    protected init(): void {
        M.FormSelect.init(queryAll('select'), {});
        this.registerFormElement('pieces', 'Pieces:', 'select', 'wikipedia.svg');
        this.registerFormElement('board', 'Board:', 'select', 'brown');
        this.registerFormElement('coordinates', 'Coordinates:', 'checkbox', false);
    }
}

export const title = 'Appearance';
export const page = new AppearanceSettings();
