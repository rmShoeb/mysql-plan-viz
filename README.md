# MySQL Execution Plan Viewer

A simple visualizer for MySQL `EXPLAIN` and `EXPLAIN ANALYZE` outputs, with `FORMAT=JSON`. It transforms complex JSON query execution plans into highly readable, interactive, and beautifully styled Directed Acyclic Graphs (DAGs).

## Features

- **Interactive Visual Graph**: Instantly converts nested JSON query plans into a left-to-right flow diagram.
- **Rich Node Details**: Every node displays comprehensive stats including Access Type, Key used, Rows examined/produced, Filter percentage, Cost, and Extra operations (like Filesort or Temp tables).
- **Intelligent Color Coding**: Quickly spot bottlenecks!
  - 🔴 **Red**: `ALL` (Full Table Scans)
  - 🟡 **Amber**: `INDEX` (Full Index Scans)
  - 🟢 **Green**: `RANGE` / `REF` (Good Index usage)
  - 🔵 **Blue**: `EQ_REF` / `CONST` (Optimal lookups)
- **Built-in JSON Editor**: Features CodeMirror with syntax highlighting and error reporting if the JSON is malformed.
- **Image Export**: Export execution plan as a high-resolution PNG.
- **Zero Server Required**: 100% client-side HTML, CSS, and JS. No backend required!

## Technology Stack

- **[Cytoscape.js](https://js.cytoscape.org/)**: Core graph rendering and interaction.
- **[Dagre](https://github.com/dagrejs/dagre)**: Automatic directed graph layout.
- **[CodeMirror](https://codemirror.net/5/)**: JSON input editor and syntax validation.
- **[Bootstrap 5](https://getbootstrap.com/) & [Bootstrap Icons](https://icons.getbootstrap.com/)**: Clean, responsive UI and iconography.

## Project Structure

- `main.html`: The main entry point and UI layout.
- `styles.css`: Custom styling, light theme, and layout constraints.
- `scripts.js`: JSON parsing logic, graph generation, and editor event listeners.
