package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

type Harness string

type Status string

const (
	Pi         Harness = "PI"
	Cline      Harness = "CLINE"
	Starting   Status  = "STARTING"
	Running    Status  = "RUNNING"
	Cancelling Status  = "CANCELLING"
	Done       Status  = "DONE"
	Cancelled  Status  = "CANCELLED"
)

type Task struct {
	ID                int
	Harness           Harness
	Prompt            string
	Status            Status
	Output            []string
	Stage             int
	StartedAt         time.Time
	CancelRequestedAt time.Time
}

type demoState struct {
	ActiveHarness  Harness
	SelectedTaskID int
	Tasks          []Task
	Notice         string
}

type model struct {
	state demoState
}

type tickMsg time.Time

var titleStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#67e8f9")).Bold(true)
var helpStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#94a3b8"))
var taskStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#c4b5fd"))
var outputStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#f8fafc"))
var noticeStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#facc15"))
var panelStyle = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("#22c55e")).Padding(1)

func initialState() demoState {
	return demoState{ActiveHarness: Pi, Notice: "ready · deterministic offline demo"}
}

func switchHarness(state demoState) demoState {
	active := Pi
	if state.ActiveHarness == Pi {
		active = Cline
	}
	selected := 0
	for _, task := range state.Tasks {
		if task.Harness == active {
			selected = task.ID
			break
		}
	}
	state.ActiveHarness = active
	state.SelectedTaskID = selected
	state.Notice = fmt.Sprintf("watching %s · existing tasks keep running", active)
	return state
}

func submit(state demoState, now time.Time) demoState {
	id := len(state.Tasks) + 1
	state.Tasks = append(state.Tasks, Task{
		ID: id, Harness: state.ActiveHarness, Prompt: "Inspect harness event flow",
		Status: Starting, Output: []string{"queued by demo driver"}, StartedAt: now,
	})
	state.SelectedTaskID = id
	state.Notice = fmt.Sprintf("submitted #%d on %s", id, state.ActiveHarness)
	return state
}

func cancelSelected(state demoState, now time.Time) demoState {
	for index := range state.Tasks {
		task := &state.Tasks[index]
		if task.ID == state.SelectedTaskID && (task.Status == Starting || task.Status == Running) {
			task.Status = Cancelling
			task.CancelRequestedAt = now
			task.Output = append(task.Output, "cancel requested by user")
		}
	}
	if state.SelectedTaskID == 0 {
		state.Notice = "no selected task"
	} else {
		state.Notice = fmt.Sprintf("cancelling #%d", state.SelectedTaskID)
	}
	return state
}

func tick(state demoState, now time.Time) demoState {
	for index := range state.Tasks {
		task := &state.Tasks[index]
		elapsed := now.Sub(task.StartedAt)
		switch {
		case task.Status == Starting && elapsed >= 320*time.Millisecond:
			task.Status = Running
			task.Stage = 1
			task.Output = append(task.Output, "streaming response")
		case task.Status == Running && task.Stage == 1 && elapsed >= 760*time.Millisecond:
			task.Stage = 2
			task.Output = append(task.Output, "✓ inspected task queue")
		case task.Status == Running && task.Stage == 2 && elapsed >= 1320*time.Millisecond:
			task.Status = Done
			task.Stage = 3
			task.Output = append(task.Output, "✓ emitted final answer")
		case task.Status == Cancelling && now.Sub(task.CancelRequestedAt) >= 240*time.Millisecond:
			task.Status = Cancelled
			task.Output = append(task.Output, "task stopped cleanly")
		}
	}
	return state
}

func activeCount(state demoState, harness Harness) int {
	count := 0
	for _, task := range state.Tasks {
		if task.Harness == harness && (task.Status == Starting || task.Status == Running || task.Status == Cancelling) {
			count++
		}
	}
	return count
}

func selectedTask(state demoState) *Task {
	for index := range state.Tasks {
		if state.Tasks[index].ID == state.SelectedTaskID {
			return &state.Tasks[index]
		}
	}
	return nil
}

func tickCommand() tea.Cmd {
	return tea.Tick(80*time.Millisecond, func(now time.Time) tea.Msg { return tickMsg(now) })
}

func (m model) Init() tea.Cmd {
	return tickCommand()
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch message := msg.(type) {
	case tea.KeyPressMsg:
		switch message.String() {
		case "q", "ctrl+c":
			return m, tea.Quit
		case "tab":
			m.state = switchHarness(m.state)
		case "enter":
			m.state = submit(m.state, time.Now())
		case "ctrl+x":
			m.state = cancelSelected(m.state, time.Now())
		}
	case tickMsg:
		m.state = tick(m.state, time.Time(message))
		return m, tickCommand()
	}
	return m, nil
}

func (m model) View() tea.View {
	current := make([]string, 0)
	for _, task := range m.state.Tasks {
		if task.Harness != m.state.ActiveHarness {
			continue
		}
		marker := " "
		if task.ID == m.state.SelectedTaskID {
			marker = "›"
		}
		current = append(current, fmt.Sprintf("%s #%d [%s] %s", marker, task.ID, task.Status, task.Prompt))
	}
	if len(current) == 0 {
		current = append(current, "  no tasks in this pane")
	}

	output := []string{"OUTPUT"}
	task := selectedTask(m.state)
	if task != nil && task.Harness == m.state.ActiveHarness {
		output = append(output, fmt.Sprintf("#%d %s · %s", task.ID, task.Harness, task.Status))
		output = append(output, task.Output...)
	} else {
		output = append(output, "Select a task to watch its stream.")
	}

	content := strings.Join([]string{
		titleStyle.Render("HARNESS SWITCHER  |  Bubble Tea"),
		fmt.Sprintf("%s PI %d active    %s CLINE %d active", marker(m.state, Pi), activeCount(m.state, Pi), marker(m.state, Cline), activeCount(m.state, Cline)),
		helpStyle.Render("Tab switch · Enter submit · Ctrl+X cancel · Q quit"),
		helpStyle.Render(strings.Repeat("─", 100)),
		taskStyle.Render("TASKS · " + string(m.state.ActiveHarness)),
		taskStyle.Render(strings.Join(current, "\n")),
		helpStyle.Render(strings.Repeat("─", 100)),
		outputStyle.Render(strings.Join(output, "\n")),
		helpStyle.Render(strings.Repeat("─", 100)),
		noticeStyle.Render(m.state.Notice),
		outputStyle.Render(string(m.state.ActiveHarness) + " > Inspect harness event flow ▏"),
	}, "\n")
	view := tea.NewView(panelStyle.Render(content))
	view.AltScreen = true
	view.WindowTitle = "Bubble Tea showcase"
	return view
}

func marker(state demoState, harness Harness) string {
	if state.ActiveHarness == harness {
		return "›"
	}
	return " "
}

func main() {
	program := tea.NewProgram(model{state: initialState()}, tea.WithFPS(30))
	if _, err := program.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
