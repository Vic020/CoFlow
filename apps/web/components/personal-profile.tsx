"use client";

import { useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Upload } from "lucide-react";
import { useAuth } from "@/components/auth-gate";
import { useI18n } from "@/components/i18n-provider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { TimezonePicker } from "@/components/timezone-picker";
import { request } from "@/lib/types";

async function prepareAvatar(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片");
  if (file.size > 5 * 1024 * 1024) throw new Error("图片不能超过 5 MB");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("无法处理图片，请重试"); });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 160;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片，请重试");
    const side = Math.min(bitmap.width, bitmap.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 160, 160);
    context.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 160, 160);
    const data = canvas.toDataURL("image/jpeg", .85);
    if (!data.startsWith("data:image/jpeg;base64,") || data.length > 90000) throw new Error("头像过大，请重新选择图片");
    return data;
  } finally { bitmap.close(); }
}

function PasswordField({ label, value, onChange, autoComplete }: {
  label: string; value: string; onChange: (value: string) => void; autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();
  return <label>{label}<span className="profile-password-input">
    <input aria-label={label} type={visible ? "text" : "password"} required maxLength={72} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} />
    <button type="button" aria-label={t(visible ? "隐藏密码" : "显示密码")} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
  </span></label>;
}

export function PersonalProfile({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const { t, timeZone, setTimeZone } = useI18n();
  const [tab, setTab] = useState("profile");
  const [name, setName] = useState(auth.me?.user.name || "");
  const [avatar, setAvatar] = useState(auth.me?.user.avatar_data || "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const zones = Array.from(new Set(["UTC", timeZone, ...Intl.supportedValuesOf("timeZone")]));
  const upload = useRef<HTMLInputElement>(null);
  const changeTab = (value: string) => { setTab(value); setError(""); setMessage(""); setCurrent(""); setNext(""); setConfirm(""); };
  const changed = name.trim() !== auth.me?.user.name || avatar !== (auth.me?.user.avatar_data || "");
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="personal-profile-dialog info-dialog" aria-describedby={undefined}
      onEscapeKeyDown={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".timezone-picker")?.querySelector('[role="combobox"]')?.getAttribute("aria-expanded") === "true") event.preventDefault();
      }}>
      <DialogTitle className="modal-title">{t("个人信息")}</DialogTitle>
      <Tabs value={tab} onValueChange={(value) => { if (!busy) changeTab(value); }} className="personal-profile-tabs">
        <TabsList aria-label={t("个人信息分类")}>
          <TabsTrigger value="profile">{t("资料")}</TabsTrigger>
          <TabsTrigger value="password">{t("密码")}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <form className="workspace-form profile-form" onSubmit={async (event) => {
            event.preventDefault(); setBusy(true); setError(""); setMessage("");
            try {
              await request("/auth/profile", { method: "PATCH", body: JSON.stringify({ name: name.trim(), avatar_data: avatar }) });
              await auth.refresh(); setMessage("资料已保存");
            } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }}>
            <fieldset disabled={busy}>
              <div className="profile-avatar-editor">
                <span className={`avatar ${auth.me?.user.color || "mint"}`} aria-hidden="true">{avatar ? <img src={avatar} alt="" /> : name.slice(0, 1) || "?"}</span>
                <input ref={upload} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t("选择头像")} onChange={async (event) => {
                  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
                  setBusy(true); setError(""); setMessage("");
                  try { setAvatar(await prepareAvatar(file)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
                }} />
                <Button type="button" size="sm" variant="outline" onClick={() => upload.current?.click()}><Upload size={15} />{t("更换头像")}</Button>
                {avatar && <Button type="button" size="sm" variant="ghost" onClick={() => setAvatar("")}>{t("移除头像")}</Button>}
              </div>
              <label>{t("团队昵称")}<input value={name} required maxLength={120} autoComplete="nickname" onChange={(event) => { setName(event.target.value); setMessage(""); }} /></label>
            </fieldset>
            <Button type="submit" disabled={busy || !name.trim() || !changed}>{busy && <Loader2 className="animate-spin" />}{t("保存修改")}</Button>
          </form>
            <div className="workspace-form profile-timezone"><label htmlFor="display-timezone">{t("展示时区")}</label><TimezonePicker value={timeZone} zones={zones} disabled={busy} onSelect={async (chosen) => {
              const previous = timeZone;
              setTimeZone(chosen); setBusy(true); setError(""); setMessage("");
              try {
                await request("/auth/preferences", { method: "PATCH", body: JSON.stringify({ display_timezone: chosen }) });
                await auth.refresh();
              } catch (e) { setTimeZone(previous); setError((e as Error).message); } finally { setBusy(false); }
            }} /></div>
        </TabsContent>
        <TabsContent value="password">
          <form className="workspace-form profile-form" onSubmit={async (event) => {
            event.preventDefault(); setError(""); setMessage("");
            if (next !== confirm) { setError("两次输入的密码不一致"); return; }
            if (new TextEncoder().encode(next).length < 8 || new TextEncoder().encode(next).length > 72) { setError("密码长度需为 8–72 字节"); return; }
            setBusy(true);
            try {
              await request("/auth/password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) });
              setCurrent(""); setNext(""); setConfirm(""); setMessage("密码已修改，其他设备需重新登录");
            } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }}>
            <fieldset disabled={busy}>
              <PasswordField label={t("当前密码")} value={current} onChange={setCurrent} autoComplete="current-password" />
              <PasswordField label={t("新密码，至少 8 位")} value={next} onChange={setNext} autoComplete="new-password" />
              <PasswordField label={t("确认新密码")} value={confirm} onChange={setConfirm} autoComplete="new-password" />
            </fieldset>
            <Button type="submit" disabled={busy || !current || !next || !confirm}>{busy && <Loader2 className="animate-spin" />}{t("修改密码")}</Button>
          </form>
        </TabsContent>
      </Tabs>
      {error && <p role="alert" className="error-text">{t(error)}</p>}
      {message && <p role="status" className="profile-feedback">{t(message)}</p>}
    </DialogContent>
  </Dialog>;
}
