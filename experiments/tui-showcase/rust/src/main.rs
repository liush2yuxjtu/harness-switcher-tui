use std::io;
use std::time::{Duration, Instant};

use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Tabs, Wrap};
use ratatui::{DefaultTerminal, Frame};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Harness {
    Pi,
    Cline,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Status {
    Starting,
    Running,
    Cancelling,
    Done,
    Cancelled,
}

struct Task {
    id: usize,
    harness: Harness,
    prompt: String,
    status: Status,
    output: Vec<String>,
    stage: u8,
    started_at: Instant,
    cancel_requested_at: Option<Instant>,
}

struct DemoState {
    active_harness: Harness,
    selected_task_id: Option<usize>,
    tasks: Vec<Task>,
    notice: String,
}

struct App {
    state: DemoState,
    exit: bool,
}

impl Default for App {
    fn default() -> Self {
        Self {
            state: DemoState {
                active_harness: Harness::Pi,
                selected_task_id: None,
                tasks: Vec::new(),
                notice: String::from("ready · deterministic offline demo"),
            },
            exit: false,
        }
    }
}

impl App {
    fn run(&mut self, terminal: &mut DefaultTerminal) -> io::Result<()> {
        while !self.exit {
            terminal.draw(|frame| self.draw(frame))?;
            self.handle_events()?;
            self.tick(Instant::now());
        }
        Ok(())
    }

    fn handle_events(&mut self) -> io::Result<()> {
        if !event::poll(Duration::from_millis(80))? {
            return Ok(());
        }
        let Event::Key(key) = event::read()? else {
            return Ok(());
        };
        if key.kind != KeyEventKind::Press {
            return Ok(());
        }
        if key.code == KeyCode::Char('q') || (key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c')) {
            self.exit = true;
        } else if key.code == KeyCode::Tab {
            self.switch_harness();
        } else if key.code == KeyCode::Enter {
            self.submit();
        } else if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('x') {
            self.cancel_selected();
        }
        Ok(())
    }

    fn switch_harness(&mut self) {
        self.state.active_harness = match self.state.active_harness {
            Harness::Pi => Harness::Cline,
            Harness::Cline => Harness::Pi,
        };
        self.state.selected_task_id = self.state.tasks.iter()
            .find(|task| task.harness == self.state.active_harness)
            .map(|task| task.id);
        self.state.notice = format!("watching {} · existing tasks keep running", harness_name(self.state.active_harness));
    }

    fn submit(&mut self) {
        let id = self.state.tasks.len() + 1;
        self.state.tasks.push(Task {
            id,
            harness: self.state.active_harness,
            prompt: String::from("Inspect harness event flow"),
            status: Status::Starting,
            output: vec![String::from("queued by demo driver")],
            stage: 0,
            started_at: Instant::now(),
            cancel_requested_at: None,
        });
        self.state.selected_task_id = Some(id);
        self.state.notice = format!("submitted #{id} on {}", harness_name(self.state.active_harness));
    }

    fn cancel_selected(&mut self) {
        let now = Instant::now();
        if let Some(id) = self.state.selected_task_id {
            if let Some(task) = self.state.tasks.iter_mut().find(|task| task.id == id) {
                if matches!(task.status, Status::Starting | Status::Running) {
                    task.status = Status::Cancelling;
                    task.cancel_requested_at = Some(now);
                    task.output.push(String::from("cancel requested by user"));
                }
            }
            self.state.notice = format!("cancelling #{id}");
        } else {
            self.state.notice = String::from("no selected task");
        }
    }

    fn tick(&mut self, now: Instant) {
        for task in &mut self.state.tasks {
            let elapsed = now.duration_since(task.started_at);
            match task.status {
                Status::Starting if elapsed >= Duration::from_millis(320) => {
                    task.status = Status::Running;
                    task.stage = 1;
                    task.output.push(String::from("streaming response"));
                }
                Status::Running if task.stage == 1 && elapsed >= Duration::from_millis(760) => {
                    task.stage = 2;
                    task.output.push(String::from("✓ inspected task queue"));
                }
                Status::Running if task.stage == 2 && elapsed >= Duration::from_millis(1320) => {
                    task.status = Status::Done;
                    task.stage = 3;
                    task.output.push(String::from("✓ emitted final answer"));
                }
                Status::Cancelling if task.cancel_requested_at.is_some_and(|at| now.duration_since(at) >= Duration::from_millis(240)) => {
                    task.status = Status::Cancelled;
                    task.output.push(String::from("task stopped cleanly"));
                }
                _ => {}
            }
        }
    }

    fn draw(&self, frame: &mut Frame) {
        let areas = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),
                Constraint::Length(1),
                Constraint::Length(1),
                Constraint::Length(1),
                Constraint::Min(7),
                Constraint::Min(5),
                Constraint::Length(1),
                Constraint::Length(1),
            ])
            .split(frame.area());

        let header = Paragraph::new(Line::from(vec![
            Span::styled("HARNESS SWITCHER  |  ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::styled("Ratatui", Style::default().fg(Color::Yellow)),
        ]));
        frame.render_widget(header, areas[0]);

        let selected_tab = match self.state.active_harness { Harness::Pi => 0, Harness::Cline => 1 };
        let tabs = Tabs::new(vec![Line::from("PI"), Line::from("CLINE")])
            .select(selected_tab)
            .highlight_style(Style::default().fg(Color::Green).add_modifier(Modifier::BOLD))
            .divider(" · ");
        frame.render_widget(tabs, areas[1]);
        frame.render_widget(Paragraph::new("Tab switch · Enter submit · Ctrl+X cancel · Q quit").style(Style::default().fg(Color::Gray)), areas[2]);
        frame.render_widget(Paragraph::new("─".repeat(100)).style(Style::default().fg(Color::DarkGray)), areas[3]);

        let items = self.state.tasks.iter()
            .filter(|task| task.harness == self.state.active_harness)
            .map(|task| {
                let marker = if self.state.selected_task_id == Some(task.id) { "›" } else { " " };
                ListItem::new(format!("{marker} #{} [{}] {}", task.id, status_name(task.status), task.prompt))
            })
            .collect::<Vec<_>>();
        let items = if items.is_empty() { vec![ListItem::new("  no tasks in this pane")] } else { items };
        let task_list = List::new(items)
            .block(Block::default().borders(Borders::ALL).title(format!("TASKS · {}", harness_name(self.state.active_harness))))
            .highlight_style(Style::default().fg(Color::Cyan));
        frame.render_widget(task_list, areas[4]);

        let output = if let Some(task) = self.state.tasks.iter().find(|task| Some(task.id) == self.state.selected_task_id && task.harness == self.state.active_harness) {
            let mut lines = vec![format!("#{} {} · {}", task.id, harness_name(task.harness), status_name(task.status))];
            lines.extend(task.output.iter().cloned());
            lines.join("\n")
        } else {
            String::from("Select a task to watch its stream.")
        };
        let output = Paragraph::new(output)
            .block(Block::default().borders(Borders::ALL).title("OUTPUT"))
            .wrap(Wrap { trim: false });
        frame.render_widget(output, areas[5]);

        frame.render_widget(Paragraph::new(self.state.notice.as_str()).style(Style::default().fg(Color::Yellow)), areas[6]);
        frame.render_widget(Paragraph::new(format!("{} > Inspect harness event flow ▏", harness_name(self.state.active_harness))).style(Style::default().fg(Color::White)), areas[7]);
    }
}

fn harness_name(harness: Harness) -> &'static str {
    match harness { Harness::Pi => "PI", Harness::Cline => "CLINE" }
}

fn status_name(status: Status) -> &'static str {
    match status {
        Status::Starting => "STARTING",
        Status::Running => "RUNNING",
        Status::Cancelling => "CANCELLING",
        Status::Done => "DONE",
        Status::Cancelled => "CANCELLED",
    }
}

fn main() -> io::Result<()> {
    ratatui::run(|terminal| App::default().run(terminal))
}
