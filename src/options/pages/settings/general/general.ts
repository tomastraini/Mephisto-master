import { byId, query } from '../../../../shared/dom';
import { SettingsPage } from '../../../util/SettingsPage';

/** Book moves beyond this point are not in the opening explorer's range. */
const MAX_BOOK_MOVE = 36;

const depthOrTimeCheckbox = byId<HTMLInputElement>('depth_or_time_checkbox');
const computeTimeInput = byId<HTMLInputElement>('compute_time_input');
const computeDepthInput = byId<HTMLInputElement>('compute_depth_input');
const bookmovesCheckbox = byId<HTMLInputElement>('bookmoves_checkbox');
const maximumBookMoveInput = byId<HTMLInputElement>('maximum_book_move_input');
const playEloInput = byId<HTMLInputElement>('play_elo_input');
const applyButton = byId<HTMLButtonElement>('apply_btn');
const stickyApplyButton = byId<HTMLButtonElement>('apply_btn1');
const changeEvaluationCheckbox = byId<HTMLInputElement>('change_evaluation_checkbox');

/** Only one of compute time / compute depth applies, so disable the other. */
function toggleComputeInputs(): void {
    computeTimeInput.disabled = depthOrTimeCheckbox.checked;
    computeDepthInput.disabled = !depthOrTimeCheckbox.checked;
}

depthOrTimeCheckbox.addEventListener('change', toggleComputeInputs);
toggleComputeInputs();

bookmovesCheckbox.addEventListener('change', () => {
    maximumBookMoveInput.disabled = !bookmovesCheckbox.checked;
    playEloInput.disabled = !bookmovesCheckbox.checked;
});

maximumBookMoveInput.addEventListener('input', () => {
    if (parseInt(maximumBookMoveInput.value) > MAX_BOOK_MOVE) {
        maximumBookMoveInput.value = String(MAX_BOOK_MOVE);
    }
});

// The sticky button at the bottom of the page is a proxy for the real one.
stickyApplyButton.addEventListener('click', () => applyButton.click());

document.addEventListener('keydown', (event) => {
    if (event.key === 's') {
        stickyApplyButton.click();
    }
    if (event.key === 'c') {
        changeEvaluationCheckbox.click();
    }
});

// TODO(phase-2): this listener never fires. The page module is imported after
// the options shell has already injected the markup, so DOMContentLoaded is
// long past by the time this runs -- the select label is not kept in sync.
// Preserved as-is here; fix it when settings move to a typed config module.
document.addEventListener('DOMContentLoaded', () => {
    byId<HTMLSelectElement>('evaluation_color_select').addEventListener('change', updateEvaluationColorLabel);
});

function updateEvaluationColorLabel(): void {
    const select = byId<HTMLSelectElement>('evaluation_color_select');
    const label = byId<HTMLInputElement>('evaluation_color_input');
    const selected = query<HTMLOptionElement>(`option[value="${select.value}"]`, select);
    label.value = select.value !== '' && selected ? selected.innerText : '';
}

class GeneralSettings extends SettingsPage {
    protected init(): void {
        this.registerFormElement('compute_time', 'Stockfish Compute Time (ms):', 'input');
        this.registerFormElement('compute_depth', 'Stockfish Depth:', 'input');
        this.registerFormElement('depth_or_time', 'Measure by depth or time:', 'checkbox');
        this.registerFormElement('fen_refresh', 'Fen Refresh Interval (ms):', 'input');
        this.registerFormElement('simon_says_mode', '"Hand and Brain" Mode:', 'checkbox');
        this.registerFormElement('preferred_responses', 'Preferred responses:', 'checkbox');

        this.registerFormElement('change_evaluation', 'Change evaluation process:', 'checkbox');
        this.registerFormElement('evaluation_color', 'Select color:', 'select');
        this.registerFormElement('evaluation_type', 'Select type:', 'select');

        this.registerFormElement('bookmoves', 'Activate book moves:', 'checkbox');
        this.registerFormElement('maximum_book_move', 'Up to move:', 'input');
        this.registerFormElement('play_elo', 'Play like (ELO):', 'input');
        this.registerFormElement('autoplay', 'Autoplay:', 'checkbox');
        this.registerFormElement('puzzle_mode', 'Puzzle Mode:', 'checkbox');
        this.registerFormElement('python_autoplay_backend', 'Python Autoplay Backend:', 'checkbox');
        this.registerFormElement('think_time', 'Simulated Think Time (ms):', 'input');
        this.registerFormElement('think_variance', 'Simulated Think Variance (ms):', 'input');
        this.registerFormElement('move_time', 'Simulated Move Time (ms):', 'input');
        this.registerFormElement('move_variance', 'Simulated Move Variance (ms):', 'input');
    }
}

export const title = 'General Settings';
export const page = new GeneralSettings();
