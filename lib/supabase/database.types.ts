export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      queue_days: {
        Row: {
          closed_at: string | null
          id: string
          last_call_at: string | null
          next_number: number
          shop_id: string
          started_at: string
        }
        Insert: {
          closed_at?: string | null
          id?: string
          last_call_at?: string | null
          next_number?: number
          shop_id: string
          started_at?: string
        }
        Update: {
          closed_at?: string | null
          id?: string
          last_call_at?: string | null
          next_number?: number
          shop_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_days_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          created_at: string
          current_queue_day_id: string | null
          heads_up_threshold: number
          id: string
          is_active: boolean
          join_radius_m: number
          joining_state: Database["public"]["Enums"]["joining_state"]
          lat: number
          lng: number
          max_queue_size: number
          name: string
          owner_user_id: string
          slug: string
        }
        Insert: {
          created_at?: string
          current_queue_day_id?: string | null
          heads_up_threshold?: number
          id?: string
          is_active?: boolean
          join_radius_m?: number
          joining_state?: Database["public"]["Enums"]["joining_state"]
          lat: number
          lng: number
          max_queue_size?: number
          name: string
          owner_user_id: string
          slug: string
        }
        Update: {
          created_at?: string
          current_queue_day_id?: string | null
          heads_up_threshold?: number
          id?: string
          is_active?: boolean
          join_radius_m?: number
          joining_state?: Database["public"]["Enums"]["joining_state"]
          lat?: number
          lng?: number
          max_queue_size?: number
          name?: string
          owner_user_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "shops_current_queue_day_id_fkey"
            columns: ["current_queue_day_id"]
            isOneToOne: false
            referencedRelation: "queue_days"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          called_at: string | null
          carried_over_at: string | null
          customer_name: string | null
          device_id: string | null
          finished_at: string | null
          heads_up_sent_at: string | null
          id: string
          joined_at: string
          last_call_choice:
            | Database["public"]["Enums"]["last_call_choice"]
            | null
          number: number
          origin: Database["public"]["Enums"]["ticket_origin"]
          parent_ticket_id: string | null
          queue_day_id: string
          removed_reason: Database["public"]["Enums"]["removed_reason"] | null
          served_at: string | null
          shop_id: string
          status: Database["public"]["Enums"]["ticket_status"]
        }
        Insert: {
          called_at?: string | null
          carried_over_at?: string | null
          customer_name?: string | null
          device_id?: string | null
          finished_at?: string | null
          heads_up_sent_at?: string | null
          id?: string
          joined_at?: string
          last_call_choice?:
            | Database["public"]["Enums"]["last_call_choice"]
            | null
          number: number
          origin: Database["public"]["Enums"]["ticket_origin"]
          parent_ticket_id?: string | null
          queue_day_id: string
          removed_reason?: Database["public"]["Enums"]["removed_reason"] | null
          served_at?: string | null
          shop_id: string
          status?: Database["public"]["Enums"]["ticket_status"]
        }
        Update: {
          called_at?: string | null
          carried_over_at?: string | null
          customer_name?: string | null
          device_id?: string | null
          finished_at?: string | null
          heads_up_sent_at?: string | null
          id?: string
          joined_at?: string
          last_call_choice?:
            | Database["public"]["Enums"]["last_call_choice"]
            | null
          number?: number
          origin?: Database["public"]["Enums"]["ticket_origin"]
          parent_ticket_id?: string | null
          queue_day_id?: string
          removed_reason?: Database["public"]["Enums"]["removed_reason"] | null
          served_at?: string | null
          shop_id?: string
          status?: Database["public"]["Enums"]["ticket_status"]
        }
        Relationships: [
          {
            foreignKeyName: "tickets_parent_ticket_id_fkey"
            columns: ["parent_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_queue_day_id_fkey"
            columns: ["queue_day_id"]
            isOneToOne: false
            referencedRelation: "queue_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      call_next: { Args: never; Returns: Json }
      called_ticket_json: {
        Args: { p_ticket: Database["public"]["Tables"]["tickets"]["Row"] }
        Returns: Json
      }
      create_shop: {
        Args: {
          p_heads_up_threshold?: number
          p_join_radius_m?: number
          p_lat: number
          p_lng: number
          p_max_queue_size?: number
          p_name: string
          p_owner_user_id: string
          p_slug: string
        }
        Returns: {
          created_at: string
          current_queue_day_id: string | null
          heads_up_threshold: number
          id: string
          is_active: boolean
          join_radius_m: number
          joining_state: Database["public"]["Enums"]["joining_state"]
          lat: number
          lng: number
          max_queue_size: number
          name: string
          owner_user_id: string
          slug: string
        }
        SetofOptions: {
          from: "*"
          to: "shops"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      customer_view_json: {
        Args: {
          p_shop: Database["public"]["Tables"]["shops"]["Row"]
          p_ticket: Database["public"]["Tables"]["tickets"]["Row"]
        }
        Returns: Json
      }
      device_ticket: {
        Args: {
          p_device_id: string
          p_shop: Database["public"]["Tables"]["shops"]["Row"]
          p_statuses: Database["public"]["Enums"]["ticket_status"][]
          p_ticket_id: string
        }
        Returns: {
          called_at: string | null
          carried_over_at: string | null
          customer_name: string | null
          device_id: string | null
          finished_at: string | null
          heads_up_sent_at: string | null
          id: string
          joined_at: string
          last_call_choice:
            | Database["public"]["Enums"]["last_call_choice"]
            | null
          number: number
          origin: Database["public"]["Enums"]["ticket_origin"]
          parent_ticket_id: string | null
          queue_day_id: string
          removed_reason: Database["public"]["Enums"]["removed_reason"] | null
          served_at: string | null
          shop_id: string
          status: Database["public"]["Enums"]["ticket_status"]
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_customer_view: {
        Args: { p_device_id?: string; p_slug: string }
        Returns: Json
      }
      get_owner_queue: { Args: never; Returns: Json }
      haversine_m: {
        Args: {
          p_lat_a: number
          p_lat_b: number
          p_lng_a: number
          p_lng_b: number
        }
        Returns: number
      }
      join_queue: {
        Args: {
          p_accuracy_m?: number
          p_device_id: string
          p_lat: number
          p_lng: number
          p_name: string
          p_slug: string
        }
        Returns: Json
      }
      leave_queue: {
        Args: { p_device_id: string; p_ticket_id: string }
        Returns: Json
      }
      lock_owner_shop: {
        Args: never
        Returns: {
          created_at: string
          current_queue_day_id: string | null
          heads_up_threshold: number
          id: string
          is_active: boolean
          join_radius_m: number
          joining_state: Database["public"]["Enums"]["joining_state"]
          lat: number
          lng: number
          max_queue_size: number
          name: string
          owner_user_id: string
          slug: string
        }
        SetofOptions: {
          from: "*"
          to: "shops"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_no_show: { Args: { p_ticket_id: string }; Returns: Json }
      mark_served: { Args: { p_ticket_id: string }; Returns: Json }
      no_show_window: { Args: never; Returns: string }
      owner_ticket: {
        Args: {
          p_shop: Database["public"]["Tables"]["shops"]["Row"]
          p_statuses: Database["public"]["Enums"]["ticket_status"][]
          p_ticket_id: string
        }
        Returns: {
          called_at: string | null
          carried_over_at: string | null
          customer_name: string | null
          device_id: string | null
          finished_at: string | null
          heads_up_sent_at: string | null
          id: string
          joined_at: string
          last_call_choice:
            | Database["public"]["Enums"]["last_call_choice"]
            | null
          number: number
          origin: Database["public"]["Enums"]["ticket_origin"]
          parent_ticket_id: string | null
          queue_day_id: string
          removed_reason: Database["public"]["Enums"]["removed_reason"] | null
          served_at: string | null
          shop_id: string
          status: Database["public"]["Enums"]["ticket_status"]
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rejoin_queue: {
        Args: { p_device_id: string; p_ticket_id: string }
        Returns: Json
      }
      remove_ticket: { Args: { p_ticket_id: string }; Returns: Json }
      served_ticket_json: {
        Args: { p_ticket: Database["public"]["Tables"]["tickets"]["Row"] }
        Returns: Json
      }
      ticket_ref_json: {
        Args: { p_ticket: Database["public"]["Tables"]["tickets"]["Row"] }
        Returns: Json
      }
      undo_served: { Args: { p_ticket_id: string }; Returns: Json }
      undo_window: { Args: never; Returns: string }
    }
    Enums: {
      joining_state: "open" | "last_call"
      last_call_choice: "stay" | "carry"
      removed_reason: "owner" | "close_shop" | "carry_over_expired"
      ticket_origin: "scan" | "rejoin"
      ticket_status:
        | "waiting"
        | "called"
        | "served"
        | "no_show"
        | "left"
        | "removed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      joining_state: ["open", "last_call"],
      last_call_choice: ["stay", "carry"],
      removed_reason: ["owner", "close_shop", "carry_over_expired"],
      ticket_origin: ["scan", "rejoin"],
      ticket_status: [
        "waiting",
        "called",
        "served",
        "no_show",
        "left",
        "removed",
      ],
    },
  },
} as const

