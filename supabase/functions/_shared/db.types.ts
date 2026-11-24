export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  api: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_username: { Args: { name: string }; Returns: string };
      health: { Args: never; Returns: string };
      my_username: { Args: never; Returns: string };
      profile: {
        Args: { username: string };
        Returns: Database["api"]["CompositeTypes"]["profile"];
        SetofOptions: {
          from: "*";
          to: "profile";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      profile: {
        username: string | null;
        keys: Database["api"]["CompositeTypes"]["profile_key"][] | null;
      };
      profile_key: {
        fingerprint: string | null;
        published_at: string | null;
        replaced_by: string | null;
        revoked_at: string | null;
      };
    };
  };
  service: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_key_challenge: {
        Args: { fingerprint: string; user_id: string };
        Returns: {
          expires_at: string;
          nonce: string;
          username: string;
        }[];
      };
      current_key: {
        Args: { user_id: string };
        Returns: {
          fingerprint: string;
          nonce: string;
          public_key: string;
          replaced_public_key: string;
        }[];
      };
      own_key: {
        Args: { fingerprint: string; user_id: string };
        Returns: {
          fingerprint: string;
          public_key: string;
        }[];
      };
      publish_key: {
        Args: {
          fingerprint: string;
          nonce: string;
          public_key: string;
          replaces?: string;
          user_id: string;
          username: string;
        };
        Returns: string;
      };
      revoke_key: {
        Args: { fingerprint: string; revocation: string; user_id: string };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]
    )
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (
    & DefaultSchema["Tables"]
    & DefaultSchema["Views"]
  ) ? (
      & DefaultSchema["Tables"]
      & DefaultSchema["Views"]
    )[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends
    {
      Insert: infer I;
    } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends
    {
      Update: infer U;
    } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][
    CompositeTypeName
  ]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  api: {
    Enums: {},
  },
  service: {
    Enums: {},
  },
} as const;
