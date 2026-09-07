# Deploy Clock App sul Mini PC (via Tailscale)

**Requisiti**: Mini PC su Tailscale (`100.88.128.85`), Python 3 installato.
Il dipendente deve installare **Tailscale** e essere invitato al tuo tailnet
(https://login.tailscale.com/admin/users → Invite).

---

## 1. Copia i file sul Mini PC

Dal tuo Mac, cartella `clock-app`:

```bash
scp index.html styles.css app.js server.py mini-pc@100.88.128.85:~/clock-app/
```

(Se la cartella non esiste, prima `ssh mini-pc@100.88.128.85 "mkdir -p ~/clock-app"`.)

## 2. Avvia il server sul Mini PC

Connettiti in SSH e lancia:

```bash
ssh mini-pc@100.88.128.85
cd ~/clock-app
python3 server.py
```

Il server ascolta su `0.0.0.0:8765`. Da Tailscale sarà raggiungibile a
**http://100.88.128.85:8765** oppure `http://mini-pc:8765` se hai MagicDNS.

## 3. Testa dal tuo Mac

```bash
open http://100.88.128.85:8765
```

Se lo vedi, il dipendente sul suo device con Tailscale attivo vede lo stesso URL.

## 4. (Consigliato) Servizio systemd — resta acceso in background

Crea `/etc/systemd/system/clock-app.service` sul Mini PC:

```ini
[Unit]
Description=Clock App
After=network.target

[Service]
Type=simple
User=mini-pc
WorkingDirectory=/home/mini-pc/clock-app
ExecStart=/usr/bin/python3 /home/mini-pc/clock-app/server.py
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Poi:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now clock-app
sudo systemctl status clock-app       # verifica
sudo journalctl -u clock-app -f       # log dal vivo
```

## 5. Aggiornamenti (di notte, quando finisci)

Dal tuo Mac:

```bash
scp index.html styles.css app.js server.py mini-pc@100.88.128.85:~/clock-app/
ssh mini-pc@100.88.128.85 "sudo systemctl restart clock-app"
```

I dati (`state.json`) sul Mini PC restano intatti — il dipendente non perde nulla.

## 6. Backup dei dati

Il file `~/clock-app/state.json` contiene tutto. Backup:

```bash
scp mini-pc@100.88.128.85:~/clock-app/state.json ~/backups/state-$(date +%F).json
```

## Sicurezza — quando basta Tailscale

- Solo dispositivi nel tuo tailnet possono raggiungere `100.88.128.85`
- Nessuno da Internet può vedere il sito
- Ogni utente accede col proprio login (username/password) come su localhost
- **Attenzione**: se sul Mini PC c'è anche traffico LAN condiviso (WiFi ufficio),
  il sito è raggiungibile anche da quella rete. Se vuoi solo Tailscale:
  imposta `BIND=100.88.128.85` nel servizio systemd (Environment).

## Se il server non è raggiungibile

L'app continua a funzionare offline (usa il cache localStorage del browser).
Il pallino sync in header diventa **rosso**. Quando il server torna online e
ricarichi la pagina, i dati si risincronizzano.
