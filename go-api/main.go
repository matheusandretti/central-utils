package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type downloadItem struct {
	AdjustedPath string
	BackupPath   string
	WorkDir      string
	ExpireAt     time.Time

	ServedAdjusted bool
	ServedBackup   bool
}

type serverState struct {
	mu    sync.Mutex
	items map[string]*downloadItem
}

var baseDir string
var workBaseDir string

func main() {
	wd, err := os.Getwd()
	if err != nil {
		wd = "."
	}
	baseDir = wd

	// pasta "temporária" dentro do go-api
	workBaseDir = filepath.Join(baseDir, "work")
	_ = os.MkdirAll(workBaseDir, 0755)

	port := os.Getenv("GO_API_PORT")
	if port == "" {
		port = "8002"
	}

	st := &serverState{items: make(map[string]*downloadItem)}

	go func() {
		t := time.NewTicker(1 * time.Minute)
		defer t.Stop()
		for range t.C {
			st.cleanupExpired()
		}
	}()

	mux := http.NewServeMux()

	mux.HandleFunc("/api/ajuste-diario-gfbr-c/processar", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Método não permitido", http.StatusMethodNotAllowed)
			return
		}
		handleProcessar(st, w, r)
	})

	// download separado
	mux.HandleFunc("/api/ajuste-diario-gfbr-c/download/ajustado/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Método não permitido", http.StatusMethodNotAllowed)
			return
		}
		handleDownload(st, w, r, "ajustado")
	})

	mux.HandleFunc("/api/ajuste-diario-gfbr-c/download/backup/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Método não permitido", http.StatusMethodNotAllowed)
			return
		}
		handleDownload(st, w, r, "backup")
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           withBasicHeaders(mux),
		ReadHeaderTimeout: 15 * time.Second,
	}

	fmt.Printf("GO API rodando em http://127.0.0.1:%s\n", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
}

func withBasicHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func handleProcessar(st *serverState, w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(512 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Falha ao ler multipart: " + err.Error()})
		return
	}

	f, fh, err := r.FormFile("arquivo")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Campo 'arquivo' é obrigatório."})
		return
	}
	defer f.Close()

	aba := strings.TrimSpace(r.FormValue("aba"))
	criarBackup := parseBoolDefaultTrue(r.FormValue("criar_backup"))

	// agora o temp fica dentro do go-api/work (não %TEMP%)
	workDir, err := os.MkdirTemp(workBaseDir, "ajuste-diario-gfbr-c-*")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "Falha ao criar diretório temporário."})
		return
	}

	origName := sanitizeFilename(fh.Filename)
	if origName == "" {
		origName = "diario.xlsx"
	}
	if !strings.HasSuffix(strings.ToLower(origName), ".xlsx") {
		origName += ".xlsx"
	}

	xlsxPath := filepath.Join(workDir, origName)
	out, err := os.Create(xlsxPath)
	if err != nil {
		_ = os.RemoveAll(workDir)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "Falha ao salvar arquivo temporário."})
		return
	}
	if _, err := io.Copy(out, f); err != nil {
		out.Close()
		_ = os.RemoveAll(workDir)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "Falha ao gravar arquivo."})
		return
	}
	out.Close()

	// resolve executável
	bin, err := resolveDotnetBinaryPath()
	if err != nil {
		_ = os.RemoveAll(workDir)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}

	args := []string{xlsxPath}
	if aba != "" {
		args = append(args, aba)
	}
	if !criarBackup {
		args = append(args, "--no-backup")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = workDir

	stdoutPipe, _ := cmd.StdoutPipe()
	stderrPipe, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		_ = os.RemoveAll(workDir)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "Falha ao iniciar execução do .NET: " + err.Error()})
		return
	}

	var outBytes, errBytes []byte
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); outBytes, _ = io.ReadAll(stdoutPipe) }()
	go func() { defer wg.Done(); errBytes, _ = io.ReadAll(stderrPipe) }()
	waitErr := cmd.Wait()
	wg.Wait()

	if ctx.Err() == context.DeadlineExceeded {
		_ = os.RemoveAll(workDir)
		writeJSON(w, http.StatusGatewayTimeout, map[string]any{"ok": false, "error": "Processamento excedeu o tempo limite."})
		return
	}
	if waitErr != nil {
		_ = os.RemoveAll(workDir)
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":          false,
			"error":       fmt.Sprintf("Erro no .NET: %v\n%s", waitErr, tailString(string(errBytes), 4000)),
			"stderr_tail": tailString(string(errBytes), 4000),
			"stdout_tail": tailString(string(outBytes), 4000),
		})
		return
	}

	resumo := parseResumoDotnet(string(outBytes))

	// backup (se o C# criou)
	backupPath := strings.TrimSpace(fmt.Sprint(resumo["backup_path"]))
	if backupPath == "" && criarBackup {
		backupPath = strings.TrimSuffix(xlsxPath, filepath.Ext(xlsxPath)) + ".backup.xlsx"
	}

	backupExists := fileExists(backupPath)

	// registra item para downloads separados
	id := randomID(16)
	st.mu.Lock()
	st.items[id] = &downloadItem{
		AdjustedPath:    xlsxPath,
		BackupPath:      backupPath,
		WorkDir:         workDir,
		ExpireAt:        time.Now().Add(15 * time.Minute),
		ServedAdjusted:  false,
		ServedBackup:    false,
	}
	st.mu.Unlock()

	// opcional: não expor caminho completo no resumo (fica mais limpo)
	if backupExists {
		resumo["backup_path"] = filepath.Base(backupPath)
	} else {
		resumo["backup_path"] = ""
	}

	payload := map[string]any{
		"ok": true,
		"resultado": resumo,
		"download_id": id,
		"download_url_ajustado": "/api/ajuste-diario-gfbr-c/download/ajustado/" + id,
	}

	if backupExists {
		payload["download_url_backup"] = "/api/ajuste-diario-gfbr-c/download/backup/" + id
	} else {
		payload["download_url_backup"] = ""
	}

	writeJSON(w, http.StatusOK, payload)
}

func handleDownload(st *serverState, w http.ResponseWriter, r *http.Request, kind string) {
	prefix := "/api/ajuste-diario-gfbr-c/download/" + kind + "/"
	id := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, prefix))
	if id == "" {
		http.NotFound(w, r)
		return
	}

	st.mu.Lock()
	item, ok := st.items[id]
	if !ok {
		st.mu.Unlock()
		http.NotFound(w, r)
		return
	}
	// expiração
	if time.Now().After(item.ExpireAt) {
		delete(st.items, id)
		st.mu.Unlock()
		_ = os.RemoveAll(item.WorkDir)
		http.NotFound(w, r)
		return
	}

	var path string
	var markServed func()

	if kind == "ajustado" {
		path = item.AdjustedPath
		markServed = func() { item.ServedAdjusted = true }
	} else {
		path = item.BackupPath
		markServed = func() { item.ServedBackup = true }
	}
	st.mu.Unlock()

	if !fileExists(path) {
		http.NotFound(w, r)
		return
	}

	f, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(path)))

	_, _ = io.Copy(w, f)

	// marca servido e limpa quando não precisar mais
	st.mu.Lock()
	item2, ok2 := st.items[id]
	if ok2 {
		markServed()
		shouldCleanup := item2.ServedAdjusted && (item2.ServedBackup || !fileExists(item2.BackupPath))
		if shouldCleanup {
			delete(st.items, id)
			workDir := item2.WorkDir
			st.mu.Unlock()
			_ = os.RemoveAll(workDir)
			return
		}
	}
	st.mu.Unlock()
}

func (st *serverState) cleanupExpired() {
	now := time.Now()
	st.mu.Lock()
	defer st.mu.Unlock()
	for id, it := range st.items {
		if now.After(it.ExpireAt) {
			_ = os.RemoveAll(it.WorkDir)
			delete(st.items, id)
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func parseBoolDefaultTrue(v string) bool {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" {
		return true
	}
	if v == "0" || v == "false" || v == "no" || v == "n" {
		return false
	}
	if v == "1" || v == "true" || v == "yes" || v == "y" {
		return true
	}
	if n, err := strconv.Atoi(v); err == nil {
		return n != 0
	}
	return true
}

func parseResumoDotnet(stdout string) map[string]any {
	res := make(map[string]any)
	lines := strings.Split(stdout, "\n")
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" || ln == "OK" {
			continue
		}
		parts := strings.SplitN(ln, ":", 2)
		if len(parts) != 2 {
			continue
		}
		k := strings.TrimSpace(parts[0])
		v := strings.TrimSpace(parts[1])
		res[k] = v
	}
	return res
}

func resolveDotnetBinaryPath() (string, error) {
	bin := strings.TrimSpace(os.Getenv("AJUSTE_DIARIO_GFBR_BIN"))
	if bin == "" {
		exe := "AjusteDiarioGfbr"
		if runtime.GOOS == "windows" {
			exe += ".exe"
		}
		bin = filepath.Join(baseDir, "bin", exe)
	} else {
		if !filepath.IsAbs(bin) {
			bin = filepath.Join(baseDir, bin)
		}
	}
	bin = filepath.Clean(bin)

	if _, err := os.Stat(bin); err != nil {
		return "", fmt.Errorf("Executável .NET não encontrado em: %s", bin)
	}
	return bin, nil
}

func randomID(nBytes int) string {
	b := make([]byte, nBytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func sanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = filepath.Base(name)
	name = strings.TrimSpace(name)
	name = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		case r == '.' || r == '-' || r == '_' || r == ' ':
			return r
		default:
			return -1
		}
	}, name)
	return strings.TrimSpace(name)
}

func tailString(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[len(s)-max:]
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}
