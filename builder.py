import customtkinter as ctk
import json
import subprocess
import glob
from datetime import datetime, timezone
import threading

# ==========================================
# ⚙️ НАСТРОЙКИ (Твои данные от GitHub)
# ==========================================
GITHUB_USER = "navorro959-droid" 
GITHUB_REPO = "sait"

def build_release_thread():
    new_version = version_entry.get().strip()
    if not new_version:
        status_label.configure(text="❌ Введи версию (например, 0.1.2)!", text_color="#ef4444")
        btn.configure(state="normal")
        return
    
    try:
        # --- Шаг 1: Обновляем tauri.conf.json ---
        status_label.configure(text="⏳ Шаг 1: Обновляем конфиг...", text_color="#fbbf24")
        app.update()
        
        tauri_path = "src-tauri/tauri.conf.json"
        with open(tauri_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        data["version"] = new_version
        
        with open(tauri_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        # --- Шаг 2: Запускаем сборку Tauri ---
        status_label.configure(text="⏳ Шаг 2: Идет сборка (жди пару минут)...", text_color="#38bdf8")
        app.update()
        
        subprocess.run("npm run tauri build", shell=True, check=True)

        # --- Шаг 3: Безопасно достаем цифровую подпись ---
        status_label.configure(text="⏳ Шаг 3: Ищем .sig подпись...", text_color="#fbbf24")
        app.update()
        
        signature = ""
        sig_files = glob.glob("src-tauri/target/release/bundle/nsis/*.sig")
        if sig_files:
            with open(sig_files[0], "r", encoding="utf-8") as f:
                signature = f.read().strip()

        # --- Шаг 4: Создаем файл latest.json ---
        status_label.configure(text="⏳ Шаг 4: Генерируем latest.json...", text_color="#fbbf24")
        app.update()

        latest_data = {
            "version": f"v{new_version}",
            "notes": "Автоматическое обновление системы.",
            "pub_date": datetime.now(timezone.utc).isoformat(),
            "platforms": {
                "windows-x86_64": {
                    "signature": signature,
                    "url": f"https://github.com/{GITHUB_USER}/{GITHUB_REPO}/releases/download/v{new_version}/remote-desktop_{new_version}_x64-setup.nsis.zip"
                }
            }
        }
        
        with open("latest.json", "w", encoding="utf-8") as f:
            json.dump(latest_data, f, indent=2)

        # --- Шаг 5: Отправляем latest.json на GitHub (Git Push) ---
        status_label.configure(text="⏳ Шаг 5: Пушим latest.json на GitHub...", text_color="#fbbf24")
        app.update()
        
        subprocess.run("git add latest.json", shell=True, check=True)
        subprocess.run(f'git commit -m "Auto-update version to v{new_version}"', shell=True, check=False) 
        subprocess.run("git push", shell=True, check=True)

        # --- Шаг 6: Заливаем архив прямо в GitHub Releases ---
        status_label.configure(text="⏳ Шаг 6: Загружаем архив в Релизы...", text_color="#38bdf8")
        app.update()
        
        zip_files = glob.glob(f"src-tauri/target/release/bundle/nsis/*_{new_version}_*setup.nsis.zip")
        if not zip_files:
            zip_files = glob.glob("src-tauri/target/release/bundle/nsis/*.zip")

        if zip_files:
            subprocess.run(f'gh release create v{new_version} "{zip_files[0]}" --title "Release v{new_version}" --notes "Автоматическое обновление"', shell=True, check=True)
        else:
            raise Exception("ZIP архив для загрузки не найден в папке сборки!")

        # --- ФИНАЛ ---
        status_label.configure(text=f"✅ Готово! Версия v{new_version} в сети.", text_color="#22c55e")
        
    except Exception as e:
        status_label.configure(text=f"❌ Ошибка: {str(e)}", text_color="#ef4444")
    
    finally:
        btn.configure(state="normal")

def start_build():
    btn.configure(state="disabled")
    threading.Thread(target=build_release_thread, daemon=True).start()

# ==========================================
# 🎨 ИНТЕРФЕЙС
# ==========================================
ctk.set_appearance_mode("dark")
app = ctk.CTk()
app.geometry("450x280")
app.title("Remote PC Auto-Updater")
app.resizable(False, False)

ctk.CTkLabel(app, text="Выпуск обновления", font=("Segoe UI", 24, "bold")).pack(pady=(20, 10))

version_entry = ctk.CTkEntry(app, placeholder_text="Введи версию (например, 0.1.3)", width=250, justify="center")
version_entry.pack(pady=10)

btn = ctk.CTkButton(app, text="🚀 Собрать и залить на GitHub", command=start_build, width=250, height=40, font=("Segoe UI", 14, "bold"), fg_color="#2563eb", hover_color="#1d4ed8")
btn.pack(pady=10)

status_label = ctk.CTkLabel(app, text="Готов к работе", font=("Segoe UI", 13))
status_label.pack(pady=10)

app.mainloop()