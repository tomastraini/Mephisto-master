import { define } from "../../../framework/require.js";
import { SettingsPage } from "../../../util/SettingsPage.js";

var depthOrTimeCheckbox = document.getElementById("depth_or_time_checkbox");
var computeTimeInput = document.getElementById("compute_time_input");
var computeDepthInput = document.getElementById("compute_depth_input");

function toggleInputs() {
    if (depthOrTimeCheckbox.checked) {
        computeTimeInput.disabled = true;
        computeDepthInput.disabled = false;
    } else {
        computeTimeInput.disabled = false;
        computeDepthInput.disabled = true;
    }
}
document.addEventListener('keydown', function(event) {
    if (event.key === 's') {
        apply_btn1.click();
    }
});
depthOrTimeCheckbox.addEventListener("change", toggleInputs);

toggleInputs();

var checkbox = document.getElementById('bookmoves_checkbox');
var maximum_book_move_input = document.getElementById('maximum_book_move_input');
var play_elo_input = document.getElementById('play_elo_input');
var apply_btn = document.getElementById('apply_btn');
var apply_btn1 = document.getElementById('apply_btn1');
checkbox.addEventListener('change', function() {
    maximum_book_move_input.disabled = !checkbox.checked;
    play_elo_input.disabled = !checkbox.checked;
});

maximum_book_move_input.addEventListener('input', function() {
    var value = parseInt(maximum_book_move_input.value);
  
    if (value > 36) {
        maximum_book_move_input.value = 36;
    }
});
apply_btn1.addEventListener('click', function() {
    apply_btn.click();
    
});
document.addEventListener("DOMContentLoaded", function() {
    const selectElem = document.getElementById('evaluation_color_select');
    selectElem.addEventListener('change', updateInputValue);
});

function updateInputValue() {
    const selectElem = document.getElementById('evaluation_color_select');
    const inputElem = document.getElementById('evaluation_color_input');
    const selectedValue = selectElem.value;

    if (selectedValue !== "") {
        inputElem.value = selectElem.querySelector(`option[value="${selectedValue}"]`).innerText;
    } else {
        inputElem.value = "";
    }
}

class GeneralSettings extends SettingsPage {
    init() {
        this.registerFormElement('compute_time', 'Stockfish Compute Time (ms):', 'input', 500);
        this.registerFormElement('compute_depth', 'Stockfish Depth:', 'input', 16);
        this.registerFormElement('depth_or_time', 'Measure by depth or time:', 'checkbox', false);
        this.registerFormElement('fen_refresh', 'Fen Refresh Interval (ms):', 'input', 20);
        this.registerFormElement('simon_says_mode', '"Hand and Brain" Mode:', 'checkbox', false);
        this.registerFormElement('preferred_responses', 'Preferred responses:', 'checkbox', true);

        this.registerFormElement('change_evaluation', 'Change evaluation process:', 'checkbox', false);
        this.registerFormElement('evaluation_color', 'Select color:', 'select', 3);
        this.registerFormElement('evaluation_type', 'Select type:', 'select', 2);

        this.registerFormElement('bookmoves', 'Activate book moves:', 'checkbox', false);
        this.registerFormElement('maximum_book_move', 'Up to move:', 'input', 8);
        this.registerFormElement('play_elo', 'Play like (ELO):', 'input', 1200);
        this.registerFormElement('autoplay', 'Autoplay:', 'checkbox', true);
        this.registerFormElement('puzzle_mode', 'Puzzle Mode:', 'checkbox', false);
        this.registerFormElement('python_autoplay_backend', 'Python Autoplay Backend:', 'checkbox', false);
        this.registerFormElement('think_time', 'Simulated Think Time (ms):', 'input', 20);
        this.registerFormElement('think_variance', 'Simulated Think Variance (ms):', 'input', 20);
        this.registerFormElement('move_time', 'Simulated Move Time (ms):', 'input', 20);
        this.registerFormElement('move_variance', 'Simulated Move Variance (ms):', 'input', 20);
    }
}

define({
    title: 'General Settings',
    page: new GeneralSettings()
});
