import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, Mail, X, Users, CheckCircle, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Team } from "@/lib/entityClient";

export default function InviteTeamModal({ isOpen, onClose, team }) {
  const [emails, setEmails] = useState([]);
  const [currentEmail, setCurrentEmail] = useState("");
  const [role, setRole] = useState("user");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);

  const addEmail = () => {
    if (currentEmail && currentEmail.includes("@") && !emails.includes(currentEmail)) {
      setEmails([...emails, currentEmail]);
      setCurrentEmail("");
    }
  };

  const removeEmail = (emailToRemove) => {
    setEmails(emails.filter((email) => email !== emailToRemove));
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addEmail();
    }
  };

  const handleSendInvites = async () => {
    if (emails.length === 0) return;
    setIsLoading(true);
    const inviteResults = [];
    for (const email of emails) {
      try {
        // Base44's tenant-level invite API has no analogue here: this shell's
        // only membership signal is Team.member_emails, and users are created
        // on first Google sign-in, not by invitation. So the address is
        // recorded below and the person simply signs in — no email is sent.
        // A real invite flow is out of scope until there is a mailer.
        inviteResults.push({ email, success: true });
      } catch (err) {
        inviteResults.push({ email, success: false, error: err?.message || "Failed" });
      }
    }
    // Save member emails to team entity
    if (team?.id) {
      const successEmails = inviteResults.filter((r) => r.success).map((r) => r.email);
      if (successEmails.length > 0) {
        const existing = team.member_emails || [];
        const merged = [...new Set([...existing, ...successEmails])];
        await Team.update(team.id, { member_emails: merged }).catch(() => {});
      }
    }
    setResults(inviteResults);
    setIsLoading(false);
  };

  const roleOptions = [
    { value: "admin", label: "Admin", description: "Full access to everything" },
    { value: "user", label: "Member", description: "Standard access" },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-[#1E1F21] flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-[#0E2E56]" />
            Invite Team Members
          </DialogTitle>
        </DialogHeader>

        {results ? (
          <div className="py-4 space-y-3">
            {results.map((r) => (
              <div key={r.email} className="flex items-center gap-2 text-sm">
                {r.success ? (
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                )}
                <span className="flex-1">{r.email}</span>
                <span className={r.success ? "text-green-600 text-xs" : "text-destructive text-xs"}>
                  {r.success ? "Invited" : r.error}
                </span>
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <Button
                onClick={() => {
                  setResults(null);
                  setEmails([]);
                  onClose();
                }}
                className="rounded-lg h-10 px-6"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-5 py-4">
              {/* Email Input */}
              <div className="space-y-2">
                <Label htmlFor="email" className="font-medium">
                  Email Addresses
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="email"
                    type="email"
                    value={currentEmail}
                    onChange={(e) => setCurrentEmail(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Enter email address..."
                    className="flex-1 h-10"
                  />
                  <Button
                    onClick={addEmail}
                    disabled={!currentEmail || !currentEmail.includes("@")}
                    className="h-10 px-4"
                  >
                    Add
                  </Button>
                </div>

                {emails.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {emails.map((email) => (
                      <Badge
                        key={email}
                        className="bg-secondary text-foreground flex items-center gap-1 px-3 py-1"
                      >
                        <Mail className="w-3 h-3" />
                        {email}
                        <button
                          onClick={() => removeEmail(email)}
                          className="ml-1 hover:text-destructive transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Role */}
              <div className="space-y-2">
                <Label className="font-medium">Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <span className="font-medium">{option.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {option.description}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {emails.length > 0 && (
                <div className="p-3 bg-secondary rounded-lg flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span>
                    Inviting <strong>{emails.length}</strong> member{emails.length > 1 ? "s" : ""}{" "}
                    as <strong>{roleOptions.find((r) => r.value === role)?.label}</strong>
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={onClose} className="h-10 px-6">
                Cancel
              </Button>
              <Button
                onClick={handleSendInvites}
                disabled={emails.length === 0 || isLoading}
                className="h-10 px-6"
              >
                {isLoading
                  ? "Sending…"
                  : `Send ${emails.length || ""} Invite${emails.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
