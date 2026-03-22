import logging
import ipywidgets as widgets
from IPython.display import display

MAX_SCROLLBACK = 50  # Limit scrollback for performance.


class OutputWidgetHandler(logging.Handler):
    """Custom logging handler sending logs to an output widget"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.widget = widgets.Output()

    def emit(self, record):
        """Overload of logging.Handler method"""
        formatted_record = self.format(record)
        new_output = {
            "name": "stdout",
            "output_type": "stream",
            "text": formatted_record + "\n",
        }
        self.widget.outputs = (new_output,) + self.widget.outputs
        if len(self.widget.outputs) > MAX_SCROLLBACK:
            self.widget.outputs = self.widget.outputs[:MAX_SCROLLBACK]

    def show_logs(self):
        """Show the logs"""
        display(self.widget)

    def clear_logs(self):
        """Clear the current logs"""
        self.widget.clear_output()
