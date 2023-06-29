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

    depthOrTimeCheckbox.addEventListener("change", toggleInputs);

    toggleInputs();

class GeneralSettings extends SettingsPage {
    init() {
        this.registerFormElement('compute_time', 'Stockfish Compute Time (ms):', 'input', 500);
        this.registerFormElement('compute_depth', 'Stockfish Depth:', 'input', 16);
        this.registerFormElement('depth_or_time', 'Measure by depth or time:', 'checkbox', 1);
        this.registerFormElement('fen_refresh', 'Fen Refresh Interval (ms):', 'input', 100);
        this.registerFormElement('simon_says_mode', '"Hand and Brain" Mode:', 'checkbox', false);
        this.registerFormElement('autoplay', 'Autoplay:', 'checkbox', false);
        this.registerFormElement('puzzle_mode', 'Puzzle Mode:', 'checkbox', false);
        this.registerFormElement('python_autoplay_backend', 'Python Autoplay Backend:', 'checkbox', false);
        this.registerFormElement('think_time', 'Simulated Think Time (ms):', 'input', 1000);
        this.registerFormElement('think_variance', 'Simulated Think Variance (ms):', 'input', 500);
        this.registerFormElement('move_time', 'Simulated Move Time (ms):', 'input', 500);
        this.registerFormElement('move_variance', 'Simulated Move Variance (ms):', 'input', 250);
    }
}

define({
    title: 'General Settings',
    page: new GeneralSettings()
});
