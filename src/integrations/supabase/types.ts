export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      case_members: {
        Row: {
          case_id: string
          joined_at: string
          role: Database["public"]["Enums"]["case_role"]
          user_id: string
        }
        Insert: {
          case_id: string
          joined_at?: string
          role: Database["public"]["Enums"]["case_role"]
          user_id: string
        }
        Update: {
          case_id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["case_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_members_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          invite_code: string
          jury_round: number
          locked: boolean
          phase: Database["public"]["Enums"]["case_phase"]
          title: string
          verdict_outcome: string | null
          verdict_summary: string | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          description?: string
          id?: string
          invite_code?: string
          jury_round?: number
          locked?: boolean
          phase?: Database["public"]["Enums"]["case_phase"]
          title: string
          verdict_outcome?: string | null
          verdict_summary?: string | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          invite_code?: string
          jury_round?: number
          locked?: boolean
          phase?: Database["public"]["Enums"]["case_phase"]
          title?: string
          verdict_outcome?: string | null
          verdict_summary?: string | null
        }
        Relationships: []
      }
      certificates: {
        Row: {
          case_id: string
          id: string
          issued_at: string
          role: Database["public"]["Enums"]["case_role"]
          user_id: string
        }
        Insert: {
          case_id: string
          id?: string
          issued_at?: string
          role: Database["public"]["Enums"]["case_role"]
          user_id: string
        }
        Update: {
          case_id?: string
          id?: string
          issued_at?: string
          role?: Database["public"]["Enums"]["case_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence: {
        Row: {
          case_id: string
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          restricted: boolean
          size_bytes: number | null
          title: string
          uploaded_by: string
        }
        Insert: {
          case_id: string
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          restricted?: boolean
          size_bytes?: number | null
          title: string
          uploaded_by: string
        }
        Update: {
          case_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          restricted?: boolean
          size_bytes?: number | null
          title?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hearing_events: {
        Row: {
          case_id: string
          content: string
          created_at: string
          id: string
          kind: string
          user_id: string | null
        }
        Insert: {
          case_id: string
          content: string
          created_at?: string
          id?: string
          kind: string
          user_id?: string | null
        }
        Update: {
          case_id?: string
          content?: string
          created_at?: string
          id?: string
          kind?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hearing_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hearing_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jury_votes: {
        Row: {
          case_id: string
          created_at: string
          round: number
          user_id: string
          vote: string
        }
        Insert: {
          case_id: string
          created_at?: string
          round: number
          user_id: string
          vote: string
        }
        Update: {
          case_id?: string
          created_at?: string
          round?: number
          user_id?: string
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "jury_votes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jury_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          case_id: string | null
          created_at: string
          id: string
          message: string
          read: boolean
          user_id: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          id?: string
          message: string
          read?: boolean
          user_id: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_phase: {
        Args: { _case: string }
        Returns: Database["public"]["Enums"]["case_phase"]
      }
      can_view_evidence: {
        Args: {
          _case: string
          _restricted: boolean
          _uploader: string
          _user: string
        }
        Returns: boolean
      }
      cast_vote: { Args: { _case: string; _vote: string }; Returns: undefined }
      create_case: {
        Args: { _description: string; _title: string }
        Returns: string
      }
      is_member: { Args: { _case: string; _user: string }; Returns: boolean }
      join_case: {
        Args: { _code: string; _role: Database["public"]["Enums"]["case_role"] }
        Returns: string
      }
      jury_tally: {
        Args: { _case: string }
        Returns: {
          guilty: number
          jurors: number
          not_guilty: number
          round: number
          status: string
          voted: number
        }[]
      }
      member_role: {
        Args: { _case: string; _user: string }
        Returns: Database["public"]["Enums"]["case_role"]
      }
      new_jury_round: { Args: { _case: string }; Returns: number }
      notify_case: {
        Args: { _case: string; _except?: string; _msg: string }
        Returns: undefined
      }
      post_hearing_event: {
        Args: { _case: string; _content: string; _kind: string }
        Returns: undefined
      }
      submit_verdict: {
        Args: { _case: string; _outcome: string; _summary: string }
        Returns: undefined
      }
      verify_certificate: {
        Args: { _id: string }
        Returns: {
          case_title: string
          certificate_id: string
          closed_at: string
          holder: string
          issued_at: string
          outcome: string
          role: Database["public"]["Enums"]["case_role"]
        }[]
      }
    }
    Enums: {
      case_phase: "pre_trial" | "hearing" | "deliberation" | "closed"
      case_role:
        | "judge"
        | "prosecutor"
        | "defense"
        | "witness"
        | "juror"
        | "observer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      case_phase: ["pre_trial", "hearing", "deliberation", "closed"],
      case_role: [
        "judge",
        "prosecutor",
        "defense",
        "witness",
        "juror",
        "observer",
      ],
    },
  },
} as const
