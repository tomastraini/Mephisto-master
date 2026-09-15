import { queryAll } from '../../../../shared/dom';
import { SettingsPage } from '../../../util/SettingsPage';

class AppearanceSettings extends SettingsPage {
    protected init(): void {
        M.FormSelect.init(queryAll('select'), {});
        this.registerFormElement('pieces', 'Pieces:', 'select');
        this.registerFormElement('board', 'Board:', 'select');
        this.registerFormElement('coordinates', 'Coordinates:', 'checkbox');
    }
}

export const title = 'Appearance';
export const page = new AppearanceSettings();
